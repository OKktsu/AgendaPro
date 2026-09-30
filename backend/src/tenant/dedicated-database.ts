import { PrismaClient } from '@prisma/client';
import type { TenantContext } from './context.js';
import type { TenantDatabase, TenantDatabaseResolver } from './database.js';

export type TenantDatabaseDirectory = {
  findActiveDatabaseKey(organizationId: string): Promise<string | null>;
};

export class TenantDatabaseUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() {
    super('Base da organização indisponível.');
    this.name = 'TenantDatabaseUnavailableError';
  }
}

/** Sem fallback para o banco compartilhado: ausência de mapeamento bloqueia o acesso. */
export class DedicatedTenantDatabaseResolver implements TenantDatabaseResolver {
  private readonly clients = new Map<string, TenantDatabase>();
  private closed = false;

  constructor(
    private readonly directory: TenantDatabaseDirectory,
    private readonly secretFor: (key: string) => string | undefined,
    private readonly createClient: (url: string) => TenantDatabase = (url) => {
      const connection = new URL(url);
      connection.searchParams.set('connection_limit', '2');
      connection.searchParams.set('pool_timeout', '10');
      return new PrismaClient({ datasources: { db: { url: connection.toString() } } });
    },
    private readonly maxClients = 20,
  ) {
    if (!Number.isInteger(maxClients) || maxClients < 1) {
      throw new Error('Limite de clientes deve ser um inteiro positivo.');
    }
  }

  async resolve(context: TenantContext): Promise<TenantDatabase> {
    if (this.closed || !context.organizationId || !context.userId) {
      throw new TenantDatabaseUnavailableError();
    }
    const key = await this.directory.findActiveDatabaseKey(context.organizationId);
    if (this.closed || !key) throw new TenantDatabaseUnavailableError();
    // Cache por tenant e referência: uma alteração de mapeamento não reutiliza o banco anterior.
    const cacheKey = JSON.stringify([context.organizationId, key]);
    const existing = this.clients.get(cacheKey);
    if (existing) return existing;
    if (this.clients.size >= this.maxClients) throw new TenantDatabaseUnavailableError();
    const url = this.secretFor(key);
    if (!url) throw new TenantDatabaseUnavailableError();
    const client = this.createClient(url);
    this.clients.set(cacheKey, client);
    return client;
  }

  async close(): Promise<void> {
    this.closed = true;
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((client) => client.$disconnect()));
  }
}
