import { createConnection } from 'node:net';
import { PrismaClient as AccountsPrismaClient } from '@agendapro/accounts-client';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';

const host = process.env.MULTIBASE_PG_HOST ?? '127.0.0.1';
const port = Number(process.env.MULTIBASE_PG_PORT ?? 55433);
const connectionUrl = (user: string, password: string, database: string) =>
  `postgresql://${user}:${password}@${host}:${port}/${database}`;

export const LAB_CONFIG = {
  host,
  port,
  accountsUrl: connectionUrl('accounts_lab', 'accounts_lab_only', 'accounts_lab'),
  tenantAUrl: connectionUrl('tenant_a_lab', 'tenant_a_lab_only', 'tenant_a_lab'),
  tenantBUrl: connectionUrl('tenant_b_lab', 'tenant_b_lab_only', 'tenant_b_lab'),
  adminUrl: connectionUrl('lab_admin', 'lab_admin_only', 'lab_admin'),
};

export async function isMultibaseLabOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: LAB_CONFIG.host, port: LAB_CONFIG.port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function createAccountsClient(url = LAB_CONFIG.accountsUrl): AccountsPrismaClient {
  return new AccountsPrismaClient({
    datasources: { db: { url } },
  });
}

export function createTenantClient(url: string): TenantPrismaClient {
  const connection = new URL(url);
  connection.searchParams.set('connection_limit', '2');
  connection.searchParams.set('pool_timeout', '10');
  return new TenantPrismaClient({
    datasources: { db: { url: connection.toString() } },
  });
}

export async function cleanLabDatabases(
  accounts: AccountsPrismaClient,
  tenantA: TenantPrismaClient,
  tenantB: TenantPrismaClient,
): Promise<void> {
  await accounts.$executeRawUnsafe('TRUNCATE TABLE "Account", "TenantDirectory" CASCADE;');
  await tenantA.$executeRawUnsafe(
    'TRUNCATE TABLE "Appointment", "Customer", "ProfessionalWorkSchedule", "ProfessionalService", "Service", "Professional", "UserProfile", "Organization" CASCADE;',
  );
  await tenantB.$executeRawUnsafe(
    'TRUNCATE TABLE "Appointment", "Customer", "ProfessionalWorkSchedule", "ProfessionalService", "Service", "Professional", "UserProfile", "Organization" CASCADE;',
  );
}
