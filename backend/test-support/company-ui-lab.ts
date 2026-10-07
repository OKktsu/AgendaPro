// Laboratório manual opt-in, exclusivo para os bancos descartáveis do Compose de testes.
import { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import { PrismaClient as TenantClient } from '@agendapro/tenant-client';
import { buildApp } from '../src/app.js';
import { createAccountsRuntime } from '../src/accounts/runtime.js';

if (process.env.COMPANY_UI_LAB !== '1' || !process.env.MULTIBASE_PG_PORT)
  throw new Error('Defina COMPANY_UI_LAB=1 e a porta do PostgreSQL descartável.');
const port = Number(process.env.MULTIBASE_PG_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Porta de laboratório inválida.');
const accountsUrl = `postgresql://accounts_lab:accounts_lab_only@127.0.0.1:${port}/accounts_lab`;
const urls = {
  LAB_A: `postgresql://tenant_a_lab:tenant_a_lab_only@127.0.0.1:${port}/tenant_a_lab`,
  LAB_B: `postgresql://tenant_b_lab:tenant_b_lab_only@127.0.0.1:${port}/tenant_b_lab`,
};
const runtime = createAccountsRuntime(accountsUrl, JSON.stringify(urls));
const accounts = new AccountsClient({ datasources: { db: { url: accountsUrl } } });
const secret = 'disposable-ui-lab-secret';
const registrations = [];
for (const [index, name] of ['Empresa A — laboratório', 'Empresa B — laboratório'].entries()) {
  registrations.push(
    await runtime.dependencies.registerOrganizationOwner({
      organizationName: name,
      name: `Pessoa ${index + 1}`,
      email: `ui-${index + 1}@example.test`,
      password: 'UiLabPassword123!',
    }),
  );
}
const a = registrations[0];
const b = registrations[1];
const directory = await accounts.tenantDirectory.findUniqueOrThrow({
  where: { id: b.organization.id },
});
const tenant = new TenantClient({
  datasources: { db: { url: urls[directory.databaseKey as keyof typeof urls] } },
});
await accounts.membership.create({
  data: { accountId: a.user.id, tenantId: b.organization.id, role: 'STAFF' },
});
await tenant.userProfile.create({
  data: {
    id: a.user.id,
    accountId: a.user.id,
    organizationId: b.organization.id,
    name: 'Pessoa 1 na empresa B',
  },
});
await tenant.customer.create({
  data: { organizationId: b.organization.id, name: 'Cliente exclusivo B', phone: '11999990000' },
});
await tenant.$disconnect();
await accounts.$disconnect();
const app = buildApp({ ...runtime.dependencies, jwtSecret: secret });
await app.listen({ host: '127.0.0.1', port: 3101 });
console.log('Laboratório UI: ui-1@example.test / UiLabPassword123! (duas empresas).');
async function close() {
  await app.close();
  await runtime.close();
  process.exit(0);
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
