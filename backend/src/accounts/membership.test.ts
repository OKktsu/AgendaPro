import type { PrismaClient } from '@agendapro/accounts-client';
import { describe, expect, it, vi } from 'vitest';
import { createMembershipAuthorizer, MembershipAccessDeniedError } from './membership.js';
import { TenantDatabaseUnavailableError } from '../tenant/dedicated-database.js';

const context = { userId: 'account-a', organizationId: 'tenant-a', role: 'OWNER' as const };
function setup(result: unknown) {
  const findUnique = vi.fn().mockResolvedValue(result);
  const authorize = createMembershipAuthorizer({
    membership: { findUnique },
  } as unknown as PrismaClient);
  return { authorize, findUnique };
}
describe('autorização por vínculo no Accounts', () => {
  it('busca pelo par conta e empresa, nunca apenas pela empresa', async () => {
    const { authorize, findUnique } = setup({
      role: 'OWNER',
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    });
    await expect(authorize(context)).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith({
      where: { accountId_tenantId: { accountId: 'account-a', tenantId: 'tenant-a' } },
      include: { tenant: true },
    });
  });
  it('nega conta sem vínculo', async () => {
    await expect(setup(null).authorize(context)).rejects.toBeInstanceOf(
      MembershipAccessDeniedError,
    );
  });
  it('nega vínculo suspenso mesmo com token válido', async () => {
    await expect(
      setup({ role: 'OWNER', status: 'SUSPENDED', tenant: { status: 'ACTIVE' } }).authorize(
        context,
      ),
    ).rejects.toBeInstanceOf(MembershipAccessDeniedError);
  });
  it('nega permissão desatualizada no token', async () => {
    await expect(
      setup({ role: 'STAFF', status: 'ACTIVE', tenant: { status: 'ACTIVE' } }).authorize(context),
    ).rejects.toBeInstanceOf(MembershipAccessDeniedError);
  });
  it('bloqueia empresa inativa', async () => {
    await expect(
      setup({ role: 'OWNER', status: 'ACTIVE', tenant: { status: 'SUSPENDED' } }).authorize(
        context,
      ),
    ).rejects.toBeInstanceOf(TenantDatabaseUnavailableError);
  });
});
