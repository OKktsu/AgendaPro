import { PrismaClient } from '@agendapro/accounts-client';
import { DedicatedTenantDatabaseResolver } from '../tenant/dedicated-database.js';
import { accountsDirectory } from './directory.js';
import { createAccountsAuth } from './auth.js';
import { z } from 'zod';

export function createAccountsRuntime(accountsUrl: string, databaseUrlsJson: string) {
  const databaseUrls = z
    .record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().url())
    .parse(JSON.parse(databaseUrlsJson));
  const identity = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}${parsed.pathname}`;
  };
  const targets = [identity(accountsUrl), ...Object.values(databaseUrls).map(identity)];
  if (new Set(targets).size !== targets.length)
    throw new Error('Cada base deve ter um destino exclusivo.');
  const accounts = new PrismaClient({ datasources: { db: { url: accountsUrl } } });
  const resolver = new DedicatedTenantDatabaseResolver(
    accountsDirectory(accounts),
    (key) => databaseUrls[key],
  );
  const auth = createAccountsAuth(accounts, resolver, databaseUrls);
  return {
    dependencies: {
      tenantDatabaseResolver: resolver,
      loginUser: auth.login,
      registerOrganizationOwner: auth.register,
    },
    async close() {
      await Promise.all([resolver.close(), accounts.$disconnect()]);
    },
  };
}
