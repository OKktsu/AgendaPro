import type { PrismaClient } from '.prisma/accounts/index.js';
import type { TenantDatabaseDirectory } from '../tenant/dedicated-database.js';

export function accountsDirectory(accounts: PrismaClient): TenantDatabaseDirectory {
  return {
    async findActiveDatabaseKey(organizationId) {
      const tenant = await accounts.tenantDirectory.findFirst({
        where: { id: organizationId, status: 'ACTIVE' },
        select: { databaseKey: true },
      });
      return tenant?.databaseKey ?? null;
    },
  };
}
