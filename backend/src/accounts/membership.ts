import type { PrismaClient } from '@agendapro/accounts-client';
import type { TenantContext } from '../auth/jwt.js';
import { TenantDatabaseUnavailableError } from '../tenant/dedicated-database.js';

export class MembershipAccessDeniedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super('Acesso à empresa revogado ou permissão alterada. Entre novamente.');
  }
}

export function createMembershipAuthorizer(accounts: PrismaClient) {
  return async (context: TenantContext) => {
    const membership = await accounts.membership.findUnique({
      where: {
        accountId_tenantId: { accountId: context.userId, tenantId: context.organizationId },
      },
      include: { tenant: true },
    });
    if (!membership || membership.status !== 'ACTIVE' || membership.role !== context.role)
      throw new MembershipAccessDeniedError();
    if (membership.tenant.status !== 'ACTIVE') throw new TenantDatabaseUnavailableError();
  };
}
