import { createConnection } from 'node:net';
import { PrismaClient as AccountsPrismaClient } from '@agendapro/accounts-client';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';
export const LAB_CONFIG = {
    host: '127.0.0.1',
    port: 55433,
    accountsUrl: 'postgresql://accounts_lab:accounts_lab_only@127.0.0.1:55433/accounts_lab',
    tenantAUrl: 'postgresql://tenant_a_lab:tenant_a_lab_only@127.0.0.1:55433/tenant_a_lab',
    tenantBUrl: 'postgresql://tenant_b_lab:tenant_b_lab_only@127.0.0.1:55433/tenant_b_lab',
    adminUrl: 'postgresql://lab_admin:lab_admin_only@127.0.0.1:55433/lab_admin',
};
export async function isMultibaseLabOnline() {
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
export function createAccountsClient(url = LAB_CONFIG.accountsUrl) {
    return new AccountsPrismaClient({
        datasources: { db: { url } },
    });
}
export function createTenantClient(url) {
    const connection = new URL(url);
    connection.searchParams.set('connection_limit', '2');
    connection.searchParams.set('pool_timeout', '10');
    return new TenantPrismaClient({
        datasources: { db: { url: connection.toString() } },
    });
}
export async function cleanLabDatabases(accounts, tenantA, tenantB) {
    await accounts.$executeRawUnsafe('TRUNCATE TABLE "Account", "TenantDirectory" CASCADE;');
    await tenantA.$executeRawUnsafe('TRUNCATE TABLE "Appointment", "Customer", "ProfessionalWorkSchedule", "ProfessionalService", "Service", "Professional", "UserProfile", "Organization" CASCADE;');
    await tenantB.$executeRawUnsafe('TRUNCATE TABLE "Appointment", "Customer", "ProfessionalWorkSchedule", "ProfessionalService", "Service", "Professional", "UserProfile", "Organization" CASCADE;');
}
