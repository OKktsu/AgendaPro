import { PrismaClient } from '@prisma/client';
import { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import { z } from 'zod';
import type { ReminderDatabases } from './reminders.js';

/** Runtime de background: sem JWT fictício, sem conexão enviada pelo cliente. */
export function createReminderDatabases(
  env: Record<string, string | undefined> = process.env,
): ReminderDatabases {
  const mode = z.enum(['shared', 'dedicated']).parse(env.DATABASE_MODE ?? 'shared');
  const clients = new Map<string, PrismaClient>();
  let accounts: AccountsClient | undefined;
  let urls: Record<string, string> = {};
  if (mode === 'dedicated') {
    try {
      const accountsUrl = z.string().url().parse(env.ACCOUNTS_DATABASE_URL);
      urls = z
        .record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().url())
        .parse(JSON.parse(env.TENANT_DATABASE_URLS ?? ''));
      const identity = (url: string) => {
        const p = new URL(url);
        return `${p.hostname.toLowerCase()}:${p.port || '5432'}${p.pathname}`;
      };
      const targets = [identity(accountsUrl), ...Object.values(urls).map(identity)];
      if (new Set(targets).size !== targets.length) throw new Error();
      accounts = new AccountsClient({ datasources: { db: { url: accountsUrl } } });
    } catch {
      throw new Error('Configuração de bases do worker inválida.');
    }
  } else {
    if (!env.DATABASE_URL) throw new Error('Worker exige DATABASE_URL no modo compartilhado.');
    clients.set('shared', new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } }));
  }
  let closed = false;
  return {
    async organizations() {
      if (closed) throw new Error('Worker encerrado.');
      const rows = accounts
        ? await accounts.tenantDirectory.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true },
            take: 21,
            orderBy: { id: 'asc' },
          })
        : await clients.get('shared')!.$queryRaw<
            Array<{ id: string }>
          >`SELECT "id" FROM "Organization" ORDER BY "id" LIMIT 21`;
      if (rows.length > 20)
        throw new Error(
          'Worker demo suporta até 20 organizações; requer paginação antes de ampliar.',
        );
      return rows.map((row) => row.id);
    },
    async resolve(organizationId) {
      if (closed) throw new Error('Worker encerrado.');
      if (!accounts) return clients.get('shared')!;
      const entry = await accounts.tenantDirectory.findFirst({
        where: { id: organizationId, status: 'ACTIVE' },
        select: { databaseKey: true },
      });
      if (!entry || !urls[entry.databaseKey]) return null;
      const cacheKey = JSON.stringify([organizationId, entry.databaseKey]);
      const cached = clients.get(cacheKey);
      if (cached) return cached;
      if (clients.size >= 20) throw new Error('Limite de conexões do worker atingido.');
      const url = new URL(urls[entry.databaseKey]);
      url.searchParams.set('connection_limit', '2');
      url.searchParams.set('pool_timeout', '10');
      const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      clients.set(cacheKey, client);
      return client;
    },
    async close() {
      closed = true;
      await Promise.all([...clients.values()].map((client) => client.$disconnect()));
      await accounts?.$disconnect();
    },
  };
}
