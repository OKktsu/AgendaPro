import { randomUUID } from 'node:crypto';
import { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import { PrismaClient as TenantClient } from '@agendapro/tenant-client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createAccountsRuntime } from './runtime.js';
import { InvalidGoogleCredentialError } from '../auth/google.js';
import { readFile } from 'node:fs/promises';
import { TenantSelectionRequiredError } from './auth.js';
import { signJwt } from '../auth/jwt.js';

const host = process.env.MULTIBASE_PG_HOST ?? '127.0.0.1';
const port = Number(process.env.MULTIBASE_PG_PORT ?? 55433);
const accountsUrl = `postgresql://accounts_lab:accounts_lab_only@${host}:${port}/accounts_lab`;
const urls = {
  LAB_A: `postgresql://tenant_a_lab:tenant_a_lab_only@${host}:${port}/tenant_a_lab`,
  LAB_B: `postgresql://tenant_b_lab:tenant_b_lab_only@${host}:${port}/tenant_b_lab`,
};

// Opt-in: nenhum acesso ao banco local normal, nem limpeza/destruição de dados.
describe.skipIf(process.env.MULTIBASE_INTEGRATION !== '1')(
  'PostgreSQL real: Accounts e dois tenants',
  () => {
    const accounts = new AccountsClient({ datasources: { db: { url: accountsUrl } } });
    const runtime = createAccountsRuntime(accountsUrl, JSON.stringify(urls));
    const app = buildApp({
      ...runtime.dependencies,
      jwtSecret: 'lab-jwt-only',
      verifyGoogleCredential: async (credential) => {
        if (credential !== 'google-b-lab-token') throw new InvalidGoogleCredentialError();
        return { subject: 'google-b-lab-subject', email: 'lab-b@example.test', name: 'Empresa B' };
      },
    });
    const clients: TenantClient[] = [];
    const identities: Array<{ token: string; user: { id: string; organizationId: string } }> = [];
    const password = 'LabPassword123!';

    beforeAll(async () => {
      for (const name of ['Empresa A', 'Empresa B']) {
        const email = name === 'Empresa A' ? 'lab-a@example.test' : 'lab-b@example.test';
        if (!(await accounts.account.findUnique({ where: { email } }))) {
          const registered = await app.inject({
            method: 'POST',
            url: '/auth/register',
            payload: {
              email,
              password,
              name,
              organizationName: name,
              ...(name === 'Empresa B' ? { googleCredential: 'google-b-lab-token' } : {}),
            },
          });
          expect(registered.statusCode, registered.body).toBe(201);
        }
        const login = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password },
        });
        expect(login.statusCode, login.body).toBe(200);
        identities.push(login.json());
        const entry = await accounts.tenantDirectory.findUniqueOrThrow({
          where: { id: login.json().user.organizationId },
        });
        clients.push(
          new TenantClient({
            datasources: { db: { url: urls[entry.databaseKey as keyof typeof urls] } },
          }),
        );
      }
    }, 30000);

    afterAll(async () => {
      await app.close();
      await runtime.close();
      await accounts.$disconnect();
      await Promise.all(clients.map((client) => client.$disconnect()));
    });
    const headers = (index: number) => ({ authorization: `Bearer ${identities[index].token}` });

    it('migra vínculos legados sem alterar credenciais e identificadores', async () => {
      const marker = new Error('rollback do laboratório');
      await expect(
        accounts.$transaction(
          async (tx) => {
            const schema = `migration_${randomUUID().replaceAll('-', '')}`;
            await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
            for (const migration of [
              '20260930000000_accounts',
              '20261003090000_add_google_subject',
            ]) {
              const sql = await readFile(
                new URL(
                  `../../prisma/accounts/migrations/${migration}/migration.sql`,
                  import.meta.url,
                ),
                'utf8',
              );
              for (const statement of sql
                .split(';')
                .filter((part) => part.trim() && !/^(BEGIN|COMMIT)$/i.test(part.trim())))
                await tx.$executeRawUnsafe(statement);
            }
            const accountId = randomUUID();
            const tenantId = randomUUID();
            await tx.$executeRaw`INSERT INTO "TenantDirectory" ("id", "databaseKey", "status", "updatedAt") VALUES (${tenantId}::uuid, 'OLD', 'ACTIVE', CURRENT_TIMESTAMP)`;
            await tx.$executeRaw`INSERT INTO "Account" ("id", "email", "passwordHash", "googleSubject", "role", "tenantId", "updatedAt") VALUES (${accountId}::uuid, 'old@example.test', 'preserved-hash', 'preserved-google', 'OWNER', ${tenantId}::uuid, CURRENT_TIMESTAMP)`;
            const sql = await readFile(
              new URL(
                '../../prisma/accounts/migrations/20261007000000_account_memberships/migration.sql',
                import.meta.url,
              ),
              'utf8',
            );
            // A transação do teste já envolve toda a migration e será revertida ao final.
            for (const statement of sql
              .split(';')
              .filter((part) => part.trim() && !/^(BEGIN|COMMIT)$/i.test(part.trim())))
              await tx.$executeRawUnsafe(statement);
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                passwordHash: string;
                googleSubject: string;
                tenantId: string;
                role: string;
                status: string;
              }>
            >`SELECT a."id", a."passwordHash", a."googleSubject", m."tenantId", m."role", m."status" FROM "Account" a JOIN "Membership" m ON m."accountId" = a."id"`;
            expect(rows).toEqual([
              {
                id: accountId,
                passwordHash: 'preserved-hash',
                googleSubject: 'preserved-google',
                tenantId,
                role: 'OWNER',
                status: 'ACTIVE',
              },
            ]);
            throw marker;
          },
          { timeout: 15000 },
        ),
      ).rejects.toBe(marker);
    });

    it('uma identidade acessa duas empresas com papéis distintos e revogação imediata', async () => {
      const accountId = identities[0].user.id;
      const tenantId = identities[1].user.organizationId;
      await accounts.membership.create({ data: { accountId, tenantId, role: 'STAFF' } });
      await clients[1].userProfile.create({
        data: { id: accountId, accountId, organizationId: tenantId, name: 'Perfil na empresa B' },
      });
      try {
        await expect(
          accounts.membership.create({ data: { accountId, tenantId, role: 'OWNER' } }),
        ).rejects.toMatchObject({ code: 'P2002' });
        const input = { email: 'lab-a@example.test', password };
        await expect(
          runtime.dependencies.loginUser({ ...input, password: 'wrong' }, 'lab-jwt-only', tenantId),
        ).rejects.toThrow();
        await expect(runtime.dependencies.loginUser(input, 'lab-jwt-only')).rejects.toBeInstanceOf(
          TenantSelectionRequiredError,
        );
        const loginResponse = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: input,
        });
        expect(loginResponse.statusCode).toBe(200);
        const selection = loginResponse.json();
        expect(selection.status).toBe('organization_selection_required');
        expect(selection.token).toBeUndefined();
        expect(selection.organizations).toHaveLength(2);
        expect(selection.organizations).toEqual(
          expect.arrayContaining([
            { id: identities[0].user.organizationId, name: 'Empresa A', role: 'OWNER' },
            { id: tenantId, name: 'Empresa B', role: 'STAFF' },
          ]),
        );
        expect(JSON.stringify(selection)).not.toContain('databaseKey');
        const choose = (organizationId: string) =>
          app.inject({
            method: 'POST',
            url: '/auth/select-organization',
            payload: { selectionToken: selection.selectionToken, organizationId },
          });
        expect((await choose(randomUUID())).statusCode).toBe(401);
        const chosen = await choose(tenantId);
        expect(chosen.statusCode).toBe(200);
        expect(chosen.json().user).toMatchObject({
          id: accountId,
          organizationId: tenantId,
          role: 'STAFF',
        });
        await expect(
          runtime.dependencies.loginUser(input, 'lab-jwt-only', randomUUID()),
        ).rejects.toThrow();
        const a = await runtime.dependencies.loginUser(
          input,
          'lab-jwt-only',
          identities[0].user.organizationId,
        );
        const b = await runtime.dependencies.loginUser(input, 'lab-jwt-only', tenantId);
        const googleAccount = await accounts.account.findUniqueOrThrow({
          where: { id: identities[1].user.id },
        });
        const googleSession = await runtime.dependencies.loginWithGoogle(
          { subject: googleAccount.googleSubject!, email: googleAccount.email },
          'lab-jwt-only',
          tenantId,
        );
        expect(googleSession.user.organizationId).toBe(tenantId);
        expect(a.user.role).toBe('OWNER');
        expect(b.user).toMatchObject({
          id: accountId,
          organizationId: tenantId,
          role: 'STAFF',
          name: 'Perfil na empresa B',
        });
        const auth = { authorization: `Bearer ${b.token}` };
        expect(
          (await app.inject({ method: 'GET', url: '/auth/me', headers: auth })).statusCode,
        ).toBe(200);
        expect(
          (await app.inject({ method: 'GET', url: '/customers', headers: auth })).statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/services',
              headers: auth,
              payload: { name: 'Não autorizado', durationMinutes: 30, price: 10 },
            })
          ).statusCode,
        ).toBe(403);
        const forgedRole = signJwt({ ...b.user, role: 'OWNER' }, 'lab-jwt-only');
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/auth/me',
              headers: { authorization: `Bearer ${forgedRole}` },
            })
          ).statusCode,
        ).toBe(403);
        await accounts.membership.update({
          where: { accountId_tenantId: { accountId, tenantId } },
          data: { status: 'SUSPENDED' },
        });
        expect((await choose(tenantId)).statusCode).toBe(401);
        expect(
          (await app.inject({ method: 'GET', url: '/auth/me', headers: auth })).statusCode,
        ).toBe(403);
        expect(
          (await app.inject({ method: 'GET', url: '/customers', headers: auth })).statusCode,
        ).toBe(403);
      } finally {
        await clients[1].userProfile.delete({ where: { accountId } });
        await accounts.membership.delete({
          where: { accountId_tenantId: { accountId, tenantId } },
        });
      }
    });

    it('cadastro Google persiste o vínculo e permite novo login no tenant correto', async () => {
      const account = await accounts.account.findUniqueOrThrow({
        where: { email: 'lab-b@example.test' },
      });
      expect(account.googleSubject).toBe('google-b-lab-subject');
      const response = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { credential: 'google-b-lab-token' },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().user).toMatchObject({
        id: account.id,
        organizationId: identities[1].user.organizationId,
      });
      const session = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${response.json().token}` },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json().user.organizationId).toBe(identities[1].user.organizationId);
    });

    it('login Google com dois vínculos exige seleção antes de acessar a agenda', async () => {
      const accountId = identities[1].user.id;
      const tenantId = identities[0].user.organizationId;
      await accounts.membership.create({ data: { accountId, tenantId, role: 'STAFF' } });
      await clients[0].userProfile.create({
        data: { id: accountId, accountId, organizationId: tenantId, name: 'Google na empresa A' },
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { credential: 'google-b-lab-token' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().status).toBe('organization_selection_required');
        expect(response.json().organizations).toHaveLength(2);
        const selectionToken = response.json().selectionToken;
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/customers',
              headers: { authorization: `Bearer ${selectionToken}` },
            })
          ).statusCode,
        ).toBe(401);
        const selected = await app.inject({
          method: 'POST',
          url: '/auth/select-organization',
          payload: { selectionToken, organizationId: tenantId },
        });
        expect(selected.statusCode).toBe(200);
        expect(selected.json().user).toMatchObject({
          id: accountId,
          organizationId: tenantId,
          role: 'STAFF',
        });
        await accounts.tenantDirectory.update({
          where: { id: tenantId },
          data: { status: 'SUSPENDED' },
        });
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/auth/select-organization',
              payload: { selectionToken, organizationId: tenantId },
            })
          ).statusCode,
        ).toBe(401);
      } finally {
        await accounts.tenantDirectory.update({
          where: { id: tenantId },
          data: { status: 'ACTIVE' },
        });
        await clients[0].userProfile.delete({ where: { accountId } });
        await accounts.membership.delete({
          where: { accountId_tenantId: { accountId, tenantId } },
        });
      }
    });

    it('vincula o Google em Accounts e mantém essa identidade fora da base do tenant', async () => {
      const account = await accounts.account.findUniqueOrThrow({
        where: { id: identities[0].user.id },
      });
      const googleSubject = `google-subject-${account.id}`;
      const loginWithGoogle = runtime.dependencies.loginWithGoogle;
      expect(loginWithGoogle).toBeDefined();

      const result = await loginWithGoogle!(
        { subject: googleSubject, email: account.email },
        'lab-jwt-only',
      );

      expect(result.user).toMatchObject({
        id: account.id,
        organizationId: identities[0].user.organizationId,
        email: account.email,
        name: 'Empresa A',
      });
      expect(
        (await accounts.account.findUniqueOrThrow({ where: { id: account.id } })).googleSubject,
      ).toBe(googleSubject);

      const tenantColumns = await clients[0].$queryRaw<
        Array<{ column_name: string }>
      >`SELECT column_name FROM information_schema.columns WHERE table_name = 'UserProfile'`;
      expect(tenantColumns.map((column) => column.column_name)).not.toContain('googleSubject');
    });

    it('guarda nome somente no perfil do tenant e hash somente no Accounts', async () => {
      const columns = await accounts.$queryRaw<
        Array<{ column_name: string }>
      >`SELECT column_name FROM information_schema.columns WHERE table_name = 'Account'`;
      expect(columns.map((c) => c.column_name)).not.toContain('name');
      const tenantColumns = await clients[0].$queryRaw<
        Array<{ column_name: string }>
      >`SELECT column_name FROM information_schema.columns WHERE table_name = 'UserProfile'`;
      expect(tenantColumns.map((c) => c.column_name)).not.toContain('passwordHash');
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'lab-a@example.test', password: 'wrong' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('mesmo ID de cliente em duas bases retorna o conteúdo da empresa autenticada', async () => {
      const id = 'cccccccc-0000-4000-8000-000000000001';
      for (const [index, client] of clients.entries()) {
        await client.customer.upsert({
          where: { id },
          create: {
            id,
            organizationId: identities[index].user.organizationId,
            name: `Cliente isolado ${index}`,
            phone: '11999990000',
          },
          update: {},
        });
      }
      for (const index of [0, 1]) {
        const response = await app.inject({
          method: 'GET',
          url: `/customers?organizationId=${identities[1 - index].user.organizationId}`,
          headers: headers(index),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().customers.find((c: { id: string }) => c.id === id).name).toBe(
          `Cliente isolado ${index}`,
        );
      }
      const updated = await app.inject({
        method: 'PATCH',
        url: `/customers/${id}`,
        headers: headers(0),
        payload: { phone: '11888880000' },
      });
      expect(updated.statusCode).toBe(200);
      expect((await clients[1].customer.findUniqueOrThrow({ where: { id } })).phone).toBe(
        '11999990000',
      );
    });

    it('o PostgreSQL rejeita a credencial A quando usada para conectar na base B', async () => {
      const wrong = new TenantClient({
        datasources: { db: { url: urls.LAB_A.replace('/tenant_a_lab', '/tenant_b_lab') } },
      });
      try {
        await expect(wrong.$queryRaw`SELECT 1`).rejects.toThrow();
      } finally {
        await wrong.$disconnect();
      }
    });

    it('suspensão bloqueia requisições mesmo com conexão já em cache', async () => {
      const id = identities[0].user.organizationId;
      await accounts.tenantDirectory.update({ where: { id }, data: { status: 'SUSPENDED' } });
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/customers',
          headers: headers(0),
        });
        expect(response.statusCode).toBe(503);
      } finally {
        await accounts.tenantDirectory.update({ where: { id }, data: { status: 'ACTIVE' } });
      }
    });

    it('retoma provisionamento FAILED com a credencial correta sem duplicar perfil', async () => {
      const id = identities[0].user.organizationId;
      await accounts.tenantDirectory.update({ where: { id }, data: { status: 'FAILED' } });
      try {
        const resumed = await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            email: 'lab-a@example.test',
            password,
            name: 'Empresa A',
            organizationName: 'Empresa A',
          },
        });
        expect(resumed.statusCode, resumed.body).toBe(201);
        expect(resumed.json().organization.id).toBe(id);
        expect(
          await clients[0].userProfile.count({ where: { accountId: identities[0].user.id } }),
        ).toBe(1);
      } finally {
        await accounts.tenantDirectory.update({ where: { id }, data: { status: 'ACTIVE' } });
      }
    });

    it('duas reservas concorrentes resultam em apenas uma gravação no PostgreSQL', async () => {
      const client = clients[0];
      const organizationId = identities[0].user.organizationId;
      const customer = await client.customer.create({
        data: { organizationId, name: 'Concorrência', phone: '11999990000' },
      });
      const professional = await client.professional.create({
        data: { organizationId, name: `Profissional ${randomUUID()}` },
      });
      const service = await client.service.create({
        data: { organizationId, name: 'Corte', durationMinutes: 45, priceInCents: 8500 },
      });
      await client.professionalService.create({
        data: { professionalId: professional.id, serviceId: service.id },
      });
      await client.professionalWorkSchedule.create({
        data: {
          professionalId: professional.id,
          weekday: 'MONDAY',
          startTime: '08:00',
          endTime: '18:00',
        },
      });
      const payload = {
        customerId: customer.id,
        professionalId: professional.id,
        serviceId: service.id,
        startsAt: '2030-01-07T13:00:00.000Z',
      };
      const results = await Promise.all(
        [1, 2].map(() =>
          app.inject({ method: 'POST', url: '/appointments', headers: headers(0), payload }),
        ),
      );
      expect(
        results.map((r) => r.statusCode).sort(),
        results.map((r) => r.body).join('\n'),
      ).toEqual([201, 409]);
      expect(await client.appointment.count({ where: { professionalId: professional.id } })).toBe(
        1,
      );
      expect(
        await clients[1].appointment.count({ where: { professionalId: professional.id } }),
      ).toBe(0);
      const wrongCompany = await app.inject({
        method: 'POST',
        url: '/appointments',
        headers: headers(1),
        payload,
      });
      expect(wrongCompany.statusCode).toBe(404);
    });
  },
);
