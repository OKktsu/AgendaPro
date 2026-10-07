import { randomUUID } from 'node:crypto';
import { PrismaClient as AccountsClient, Prisma } from '@agendapro/accounts-client';
import { PrismaClient as TenantClient } from '@agendapro/tenant-client';
import type { z } from 'zod';
import { InvalidCredentialsError, type loginBodySchema } from '../auth/login.js';
import { signJwt, type AuthenticatedUser } from '../auth/jwt.js';
import { GoogleRegistrationRequiredError, type GoogleIdentity } from '../auth/google.js';
import {
  EmailAlreadyRegisteredError,
  hashPassword,
  verifyPassword,
  type registerBodySchema,
} from '../auth/register.js';
import type { DedicatedTenantDatabaseResolver } from '../tenant/dedicated-database.js';

export class TenantSelectionRequiredError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Escolha uma empresa para continuar.');
  }
}

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
  async function session(
    account: { id: string; email: string },
    secret: string,
    tenantId?: string,
  ) {
    const memberships = await accounts.membership.findMany({
      where: {
        accountId: account.id,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
        ...(tenantId ? { tenantId } : {}),
      },
    });
    if (!memberships.length) throw new InvalidCredentialsError();
    if (memberships.length !== 1) throw new TenantSelectionRequiredError();
    const membership = memberships[0];
    const context = {
      userId: account.id,
      organizationId: membership.tenantId,
      role: membership.role,
    };
    const db = await resolver.resolve(context);
    const profiles = await db.$queryRaw<Array<{ name: string }>>`
      SELECT "name" FROM "UserProfile" WHERE "accountId" = ${account.id}::uuid AND "organizationId" = ${membership.tenantId}::uuid
    `;
    if (profiles.length !== 1) throw new InvalidCredentialsError();
    const user: AuthenticatedUser = {
      id: account.id,
      organizationId: membership.tenantId,
      role: membership.role,
      email: account.email,
      name: profiles[0].name,
    };
    return { user, token: signJwt(user, secret) };
  }

  async function login(input: z.infer<typeof loginBodySchema>, secret: string, tenantId?: string) {
    const account = await accounts.account.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    return session(account, secret, tenantId);
  }

  async function loginWithGoogle(identity: GoogleIdentity, secret: string, tenantId?: string) {
    const linkedAccount = await accounts.account.findUnique({
      where: { googleSubject: identity.subject },
    });
    const account =
      linkedAccount ??
      (await accounts.account.findUnique({
        where: { email: identity.email },
      }));

    if (!account) throw new GoogleRegistrationRequiredError(identity);

    if (
      !account ||
      (!linkedAccount && account.email !== identity.email) ||
      (account.googleSubject && account.googleSubject !== identity.subject)
    ) {
      throw new InvalidCredentialsError();
    }

    if (!account.googleSubject) {
      const linked = await accounts.account.updateMany({
        where: { id: account.id, googleSubject: null },
        data: { googleSubject: identity.subject },
      });

      if (linked.count !== 1) {
        const concurrentLink = await accounts.account.findUnique({
          where: { googleSubject: identity.subject },
          select: { id: true },
        });

        if (concurrentLink?.id !== account.id) {
          throw new InvalidCredentialsError();
        }
      }
    }

    return session(account, secret, tenantId);
  }

  async function register(
    input: z.infer<typeof registerBodySchema>,
    googleIdentity?: GoogleIdentity,
  ) {
    const email = googleIdentity?.email ?? input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    let accountId: string = randomUUID();
    let tenantId: string = randomUUID();
    let databaseKey: string;
    try {
      databaseKey = await accounts.$transaction(
        async (tx) => {
          const existing = await tx.account.findUnique({
            where: { email },
            include: { memberships: { include: { tenant: true } } },
          });
          if (existing) {
            const membership = existing.memberships[0];
            if (
              existing.memberships.length !== 1 ||
              membership.role !== 'OWNER' ||
              membership.status !== 'ACTIVE' ||
              membership.tenant.status !== 'FAILED' ||
              (googleIdentity &&
                existing.googleSubject &&
                existing.googleSubject !== googleIdentity.subject) ||
              !(await verifyPassword(input.password, existing.passwordHash))
            ) {
              throw new EmailAlreadyRegisteredError();
            }
            const claimed = await tx.tenantDirectory.updateMany({
              where: { id: membership.tenantId, status: 'FAILED' },
              data: { status: 'PROVISIONING' },
            });
            if (claimed.count !== 1 || !databaseUrls[membership.tenant.databaseKey])
              throw new ProvisioningUnavailableError();
            accountId = existing.id;
            tenantId = membership.tenantId;
            if (googleIdentity && !existing.googleSubject) {
              await tx.account.update({
                where: { id: existing.id },
                data: { googleSubject: googleIdentity.subject },
              });
            }
            return membership.tenant.databaseKey;
          }
          const assigned = await tx.tenantDirectory.findMany({ select: { databaseKey: true } });
          const key = Object.keys(databaseUrls).find(
            (candidate) => !assigned.some((row) => row.databaseKey === candidate),
          );
          if (!key) throw new ProvisioningUnavailableError();
          await tx.tenantDirectory.create({ data: { id: tenantId, databaseKey: key } });
          await tx.account.create({
            data: {
              id: accountId,
              email,
              passwordHash,
              memberships: { create: { tenantId, role: 'OWNER' } },
              googleSubject: googleIdentity?.subject,
            },
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

  return { login, loginWithGoogle, register };
}
