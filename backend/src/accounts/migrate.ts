import type { PrismaClient as LegacyClient } from '@prisma/client';
import type { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import type { PrismaClient as TenantClient } from '@agendapro/tenant-client';

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Copia uma organização; nunca remove nem altera registros na origem. Executar em manutenção. */
export async function migrateOrganization(
  source: LegacyClient,
  accounts: AccountsClient,
  target: TenantClient,
  organizationId: string,
  databaseKey: string,
  apply = false,
) {
  const readSnapshot = () =>
    source.$transaction(
      async (tx) => ({
        organization: await tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        users: await tx.user.findMany({ where: { organizationId } }),
        customers: await tx.customer.findMany({ where: { organizationId } }),
        services: await tx.service.findMany({ where: { organizationId } }),
        professionals: await tx.professional.findMany({ where: { organizationId } }),
        links: await tx.professionalService.findMany({
          where: { professional: { organizationId } },
        }),
        schedules: await tx.professionalWorkSchedule.findMany({
          where: { professional: { organizationId } },
        }),
        appointments: await tx.appointment.findMany({ where: { organizationId } }),
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  const snapshot = await readSnapshot();
  const counts = Object.fromEntries(
    Object.entries(snapshot)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as unknown[]).length]),
  );
  if (!apply) return { applied: false, counts };
  const profiles = snapshot.users.map(({ id, name, createdAt, updatedAt }) => ({
    id,
    accountId: id,
    organizationId,
    name,
    createdAt,
    updatedAt,
  }));
  await accounts.$transaction(async (tx) => {
    const existing = await tx.tenantDirectory.findUnique({ where: { id: organizationId } });
    if (existing && existing.databaseKey !== databaseKey)
      throw new Error('Organização já associada a outra base.');
    await tx.tenantDirectory.upsert({
      where: { id: organizationId },
      create: { id: organizationId, databaseKey },
      update: { status: 'PROVISIONING' },
    });
    for (const user of snapshot.users) {
      const data = {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        googleSubject: user.googleSubject,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
      const found = await tx.account.findUnique({ where: { id: user.id } });
      if (found && canonical(found) !== canonical(data))
        throw new Error('Conta de destino divergente.');
      if (!found) await tx.account.create({ data });
      const membershipData = {
        accountId: user.id,
        tenantId: organizationId,
        role: user.role,
        status: 'ACTIVE' as const,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
      const membership = await tx.membership.findUnique({
        where: { accountId_tenantId: { accountId: user.id, tenantId: organizationId } },
      });
      if (membership && canonical(membership) !== canonical(membershipData))
        throw new Error('Vínculo de destino divergente.');
      if (!membership) await tx.membership.create({ data: membershipData });
    }
  });
  try {
    await target.$transaction(
      async (tx) => {
        if (await tx.organization.count({ where: { id: { not: organizationId } } }))
          throw new Error('Destino contém outra empresa.');
        await tx.organization.createMany({ data: [snapshot.organization], skipDuplicates: true });
        await tx.userProfile.createMany({ data: profiles, skipDuplicates: true });
        await tx.customer.createMany({ data: snapshot.customers, skipDuplicates: true });
        await tx.service.createMany({ data: snapshot.services, skipDuplicates: true });
        await tx.professional.createMany({ data: snapshot.professionals, skipDuplicates: true });
        await tx.professionalService.createMany({ data: snapshot.links, skipDuplicates: true });
        await tx.professionalWorkSchedule.createMany({
          data: snapshot.schedules,
          skipDuplicates: true,
        });
        await tx.appointment.createMany({ data: snapshot.appointments, skipDuplicates: true });
        const actual = {
          organization: await tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
          profiles: await tx.userProfile.findMany(),
          customers: await tx.customer.findMany(),
          services: await tx.service.findMany(),
          professionals: await tx.professional.findMany(),
          links: await tx.professionalService.findMany(),
          schedules: await tx.professionalWorkSchedule.findMany(),
          appointments: await tx.appointment.findMany(),
        };
        const { users: _users, ...expected } = snapshot;
        void _users;
        if (canonical(actual) !== canonical({ ...expected, profiles }))
          throw new Error('Verificação de conteúdo falhou; destino divergente.');
      },
      { timeout: 60000 },
    );
    if (canonical(await readSnapshot()) !== canonical(snapshot))
      throw new Error('Origem mudou durante a migração. Repita em manutenção.');
    await accounts.tenantDirectory.update({
      where: { id: organizationId },
      data: { status: 'ACTIVE' },
    });
    return { applied: true, counts };
  } catch (error) {
    await accounts.tenantDirectory.update({
      where: { id: organizationId },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}
