import { randomUUID } from 'node:crypto';
import { PrismaClient as AccountsClient, Prisma } from '@agendapro/accounts-client';
import { PrismaClient as TenantClient } from '@agendapro/tenant-client';
import type { z } from 'zod';
import { InvalidCredentialsError, type loginBodySchema } from '../auth/login.js';
import { signJwt } from '../auth/jwt.js';
import {
  EmailAlreadyRegisteredError,
  hashPassword,
  verifyPassword,
  type registerBodySchema,
} from '../auth/register.js';
import type { DedicatedTenantDatabaseResolver } from '../tenant/dedicated-database.js';

export class ProvisioningUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() {
    super('Não foi possível preparar a organização. Entre em contato com o administrador.');
  }
}

/** As bases disponíveis já devem ter schema e credenciais exclusivos, preparados pelo operador. */
export function createAccountsAuth(
  accounts: AccountsClient,
  resolver: DedicatedTenantDatabaseResolver,
  databaseUrls: Readonly<Record<string, string>>,
) {
  async function login(input: z.infer<typeof loginBodySchema>, secret: string) {
    const account = await accounts.account.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { tenant: true },
    });
    if (
      !account ||
      !(await verifyPassword(input.password, account.passwordHash)) ||
      account.tenant.status !== 'ACTIVE'
    ) {
      throw new InvalidCredentialsError();
    }
    const context = { userId: account.id, organizationId: account.tenantId, role: account.role };
    const db = await resolver.resolve(context);
    const profiles = await db.$queryRaw<Array<{ name: string }>>`
      SELECT "name" FROM "UserProfile" WHERE "accountId" = ${account.id}::uuid AND "organizationId" = ${account.tenantId}::uuid
    `;
    if (profiles.length !== 1) throw new InvalidCredentialsError();
    const user = {
      id: account.id,
      organizationId: account.tenantId,
      role: account.role,
      email: account.email,
      name: profiles[0].name,
    };
    return { user, token: signJwt(user, secret) };
  }

  async function register(input: z.infer<typeof registerBodySchema>) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    let accountId: string = randomUUID();
    let tenantId: string = randomUUID();
    let databaseKey: string;
    try {
      databaseKey = await accounts.$transaction(
        async (tx) => {
          const existing = await tx.account.findUnique({
            where: { email },
            include: { tenant: true },
          });
          if (existing) {
            if (
              existing.role !== 'OWNER' ||
              existing.tenant.status !== 'FAILED' ||
              !(await verifyPassword(input.password, existing.passwordHash))
            ) {
              throw new EmailAlreadyRegisteredError();
            }
            const claimed = await tx.tenantDirectory.updateMany({
              where: { id: existing.tenantId, status: 'FAILED' },
              data: { status: 'PROVISIONING' },
            });
            if (claimed.count !== 1 || !databaseUrls[existing.tenant.databaseKey])
              throw new ProvisioningUnavailableError();
            accountId = existing.id;
            tenantId = existing.tenantId;
            return existing.tenant.databaseKey;
          }
          const assigned = await tx.tenantDirectory.findMany({ select: { databaseKey: true } });
          const key = Object.keys(databaseUrls).find(
            (candidate) => !assigned.some((row) => row.databaseKey === candidate),
          );
          if (!key) throw new ProvisioningUnavailableError();
          await tx.tenantDirectory.create({ data: { id: tenantId, databaseKey: key } });
          await tx.account.create({
            data: { id: accountId, tenantId, email, passwordHash, role: 'OWNER' },
          });
          return key;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof EmailAlreadyRegisteredError ||
        error instanceof ProvisioningUnavailableError
      )
        throw error;
      // Concorrência na alocação não pode atribuir a mesma base a duas empresas.
      throw new ProvisioningUnavailableError();
    }

    const tenant = new TenantClient({ datasources: { db: { url: databaseUrls[databaseKey] } } });
    try {
      const organization = await tenant.$transaction(async (tx) => {
        // Não alocar banco com dados de uma empresa anterior, mesmo com catálogo inconsistente.
        if (await tx.organization.count({ where: { id: { not: tenantId } } }))
          throw new ProvisioningUnavailableError();
        const org = await tx.organization.upsert({
          where: { id: tenantId },
          create: { id: tenantId, name: input.organizationName },
          update: {},
        });
        const profile = await tx.userProfile.upsert({
          where: { accountId },
          create: { id: accountId, accountId, organizationId: tenantId, name: input.name },
          update: {},
        });
        if (profile.organizationId !== tenantId) throw new ProvisioningUnavailableError();
        return org;
      });
      await accounts.tenantDirectory.update({
        where: { id: tenantId },
        data: { status: 'ACTIVE' },
      });
      return {
        organization,
        user: {
          id: accountId,
          organizationId: tenantId,
          name: input.name,
          email,
          role: 'OWNER' as const,
        },
      };
    } catch {
      await accounts.tenantDirectory.update({
        where: { id: tenantId },
        data: { status: 'FAILED' },
      });
      throw new ProvisioningUnavailableError();
    } finally {
      await tenant.$disconnect();
    }
  }

  return { login, register };
}
