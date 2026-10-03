import 'dotenv/config';
import { stat } from 'node:fs/promises';
import { PrismaClient as LegacyClient } from '@prisma/client';
import { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import { PrismaClient as TenantClient } from '@agendapro/tenant-client';
import { z } from 'zod';
import { migrateOrganization } from './migrate.js';

const env = z
  .object({
    MIGRATION_SOURCE_URL: z.string().url(),
    ACCOUNTS_DATABASE_URL: z.string().url(),
    TENANT_DATABASE_URL: z.string().url(),
    MIGRATION_ORGANIZATION_ID: z.string().uuid(),
    MIGRATION_DATABASE_KEY: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    MIGRATION_BACKUP_FILE: z.string().optional(),
  })
  .safeParse(process.env);
if (!env.success) throw new Error('Variáveis de migração ausentes ou inválidas.');
const config = env.data;
const identity = (value: string) => {
  const url = new URL(value);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
};
if (
  new Set(
    [config.MIGRATION_SOURCE_URL, config.ACCOUNTS_DATABASE_URL, config.TENANT_DATABASE_URL].map(
      identity,
    ),
  ).size !== 3
)
  throw new Error('Origem, Accounts e destino devem ser bases diferentes.');
const apply = process.argv.includes('--apply');
if (
  apply &&
  (!config.MIGRATION_BACKUP_FILE || (await stat(config.MIGRATION_BACKUP_FILE)).size === 0)
)
  throw new Error('Aplicação exige arquivo de backup não vazio e manutenção da origem.');
const source = new LegacyClient({ datasources: { db: { url: config.MIGRATION_SOURCE_URL } } });
const accounts = new AccountsClient({ datasources: { db: { url: config.ACCOUNTS_DATABASE_URL } } });
const target = new TenantClient({ datasources: { db: { url: config.TENANT_DATABASE_URL } } });
try {
  console.log(
    await migrateOrganization(
      source,
      accounts,
      target,
      config.MIGRATION_ORGANIZATION_ID,
      config.MIGRATION_DATABASE_KEY,
      apply,
    ),
  );
} catch {
  console.error(
    'Migração não concluída. Origem preservada; confira configuração, manutenção e integridade do destino.',
  );
  process.exitCode = 1;
} finally {
  await Promise.all([source.$disconnect(), accounts.$disconnect(), target.$disconnect()]);
}
