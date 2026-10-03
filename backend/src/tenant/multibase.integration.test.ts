import type { PrismaClient as TenantPrismaClient } from '@prisma/client';
import type { PrismaClient as AccountsPrismaClient } from '@agendapro/accounts-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LAB_CONFIG,
  cleanLabDatabases,
  createAccountsClient,
  createTenantClient,
  isMultibaseLabOnline,
} from './multibase-helper.js';
import { accountsDirectory } from '../accounts/directory.js';
import { buildApp } from '../app.js';
import { signJwt } from '../auth/jwt.js';
import {
  DedicatedTenantDatabaseResolver,
  TenantDatabaseUnavailableError,
} from './dedicated-database.js';

const integrationEnabled = process.env.MULTIBASE_TENANT_INTEGRATION === '1';
const labOnline = integrationEnabled && (await isMultibaseLabOnline());

describe.runIf(labOnline)('Testes de Integração Multi-Banco (PostgreSQL Dedicado)', () => {
  const jwtSecret = 'test-secret-multibase-2026';

  const orgAId = '11111111-1111-4111-8111-111111111111';
  const orgBId = '22222222-2222-4222-8222-222222222222';
  const orgCId = '33333333-3333-4333-8333-333333333333'; // PROVISIONING

  let accountsClient: AccountsPrismaClient;
  let tenantAClient: TenantPrismaClient;
  let tenantBClient: TenantPrismaClient;
  let resolver: DedicatedTenantDatabaseResolver;

  const secretFor = (key: string): string | undefined => {
    if (key === 'TENANT_A_KEY') return LAB_CONFIG.tenantAUrl;
    if (key === 'TENANT_B_KEY') return LAB_CONFIG.tenantBUrl;
    return undefined;
  };

  beforeAll(async () => {
    accountsClient = createAccountsClient();
    tenantAClient = createTenantClient(LAB_CONFIG.tenantAUrl);
    tenantBClient = createTenantClient(LAB_CONFIG.tenantBUrl);
  });

  afterAll(async () => {
    if (resolver) {
      await resolver.close();
    }
    await Promise.allSettled([
      accountsClient?.$disconnect(),
      tenantAClient?.$disconnect(),
      tenantBClient?.$disconnect(),
    ]);
  });

  beforeEach(async () => {
    await cleanLabDatabases(accountsClient, tenantAClient, tenantBClient);

    // Cadastra diretório de tenants em accounts_lab
    await accountsClient.tenantDirectory.createMany({
      data: [
        { id: orgAId, databaseKey: 'TENANT_A_KEY', status: 'ACTIVE' },
        { id: orgBId, databaseKey: 'TENANT_B_KEY', status: 'ACTIVE' },
        { id: orgCId, databaseKey: 'TENANT_C_KEY', status: 'PROVISIONING' },
      ],
    });

    // Registra as organizações nos respectivos bancos de tenant
    await tenantAClient.organization.create({
      data: { id: orgAId, name: 'Empresa A - Barbearia Lab' },
    });
    await tenantBClient.organization.create({
      data: { id: orgBId, name: 'Empresa B - Salão Lab' },
    });

    if (resolver) {
      await resolver.close();
    }
    resolver = new DedicatedTenantDatabaseResolver(
      accountsDirectory(accountsClient),
      secretFor,
      createTenantClient,
      20,
    );
  });

  describe('Cenário 1: Isolamento de Permissões e Segurança por Role', () => {
    it('impede que o usuário do Accounts conecte na base tenant_a_lab', async () => {
      const unauthorizedClient = createTenantClient(
        `postgresql://accounts_lab:accounts_lab_only@${LAB_CONFIG.host}:${LAB_CONFIG.port}/tenant_a_lab`,
      );
      try {
        await expect(unauthorizedClient.$queryRaw`SELECT 1`).rejects.toThrow(
          /permission denied for database|P1000|P1010/i,
        );
      } finally {
        await unauthorizedClient.$disconnect().catch(() => {});
      }
    });

    it('impede que o usuário do tenant A conecte na base tenant_b_lab', async () => {
      const unauthorizedClient = createTenantClient(
        `postgresql://tenant_a_lab:tenant_a_lab_only@${LAB_CONFIG.host}:${LAB_CONFIG.port}/tenant_b_lab`,
      );
      try {
        await expect(unauthorizedClient.$queryRaw`SELECT 1`).rejects.toThrow(
          /permission denied for database|P1000|P1010/i,
        );
      } finally {
        await unauthorizedClient.$disconnect().catch(() => {});
      }
    });

    it('permite conexões bem-sucedidas em cada base com suas próprias credenciais', async () => {
      const dbAccounts = await accountsClient.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database();`;
      const dbA = await tenantAClient.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database();`;
      const dbB = await tenantBClient.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database();`;

      expect(dbAccounts[0].current_database).toBe('accounts_lab');
      expect(dbA[0].current_database).toBe('tenant_a_lab');
      expect(dbB[0].current_database).toBe('tenant_b_lab');
    });
  });

  describe('Cenário 2: Resolução Dinâmica com DedicatedTenantDatabaseResolver', () => {
    it('resolve a conexão correta consultando TenantDirectory e reutiliza o mesmo cliente', async () => {
      const clientA1 = await resolver.resolve({
        organizationId: orgAId,
        userId: 'u1',
        role: 'OWNER',
      });
      const clientA2 = await resolver.resolve({
        organizationId: orgAId,
        userId: 'u2',
        role: 'STAFF',
      });
      const clientB = await resolver.resolve({
        organizationId: orgBId,
        userId: 'u3',
        role: 'OWNER',
      });

      expect(clientA1).toBe(clientA2);
      expect(clientB).not.toBe(clientA1);

      const aQuery = await clientA1.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database();`;
      const bQuery = await clientB.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database();`;

      expect(aQuery[0].current_database).toBe('tenant_a_lab');
      expect(bQuery[0].current_database).toBe('tenant_b_lab');
    });

    it('bloqueia tenant com status PROVISIONING ou inexistente com status 503', async () => {
      await expect(
        resolver.resolve({ organizationId: orgCId, userId: 'u1', role: 'OWNER' }),
      ).rejects.toBeInstanceOf(TenantDatabaseUnavailableError);

      await expect(
        resolver.resolve({
          organizationId: '99999999-9999-4999-8999-999999999999',
          userId: 'u1',
          role: 'OWNER',
        }),
      ).rejects.toBeInstanceOf(TenantDatabaseUnavailableError);
    });

    it('rejeita novas conexões quando o limite máximo de clientes do pool é atingido', async () => {
      const limitedResolver = new DedicatedTenantDatabaseResolver(
        accountsDirectory(accountsClient),
        secretFor,
        createTenantClient,
        1,
      );
      try {
        await limitedResolver.resolve({ organizationId: orgAId, userId: 'u1', role: 'OWNER' });
        await expect(
          limitedResolver.resolve({ organizationId: orgBId, userId: 'u2', role: 'OWNER' }),
        ).rejects.toThrow(TenantDatabaseUnavailableError);
      } finally {
        await limitedResolver.close();
      }
    });
  });

  describe('Cenário 3: Isolamento Físico e Imunidade a Colisão de IDs', () => {
    it('permite registros com o mesmo ID em bancos diferentes sem violar chave primária', async () => {
      const sharedCustomerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

      // Cria cliente na Empresa A
      const custA = await tenantAClient.customer.create({
        data: {
          id: sharedCustomerId,
          organizationId: orgAId,
          name: 'Cliente da Empresa A',
          phone: '11911111111',
        },
      });

      // Cria cliente com O MESMO ID na Empresa B
      const custB = await tenantBClient.customer.create({
        data: {
          id: sharedCustomerId,
          organizationId: orgBId,
          name: 'Cliente da Empresa B',
          phone: '11922222222',
        },
      });

      expect(custA.id).toBe(sharedCustomerId);
      expect(custB.id).toBe(sharedCustomerId);
      expect(custA.name).toBe('Cliente da Empresa A');
      expect(custB.name).toBe('Cliente da Empresa B');

      // Busca direta no banco A só encontra o cliente A
      const searchInA = await tenantAClient.customer.findUnique({
        where: { id: sharedCustomerId },
      });
      expect(searchInA?.name).toBe('Cliente da Empresa A');

      // Busca direta no banco B só encontra o cliente B
      const searchInB = await tenantBClient.customer.findUnique({
        where: { id: sharedCustomerId },
      });
      expect(searchInB?.name).toBe('Cliente da Empresa B');

      // Contagem em cada banco é independente
      expect(await tenantAClient.customer.count()).toBe(1);
      expect(await tenantBClient.customer.count()).toBe(1);
    });
  });

  describe('Cenário 4: Restrição Nativa GiST e Concorrência Real de Reservas', () => {
    it('dispara erro de exclusão do PostgreSQL em reservas sobrepostas na Empresa A enquanto Empresa B reserva sem conflito', async () => {
      // 1. Setup na Empresa A
      const profA = await tenantAClient.professional.create({
        data: { organizationId: orgAId, name: 'Barbeiro João (Empresa A)' },
      });
      const servA = await tenantAClient.service.create({
        data: {
          organizationId: orgAId,
          name: 'Corte Lab A',
          durationMinutes: 60,
          priceInCents: 5000,
        },
      });
      const custA = await tenantAClient.customer.create({
        data: { organizationId: orgAId, name: 'Cliente A', phone: '11999990001' },
      });

      // 2. Setup na Empresa B
      const profB = await tenantBClient.professional.create({
        data: { organizationId: orgBId, name: 'Cabeleireira Maria (Empresa B)' },
      });
      const servB = await tenantBClient.service.create({
        data: {
          organizationId: orgBId,
          name: 'Penteado Lab B',
          durationMinutes: 60,
          priceInCents: 8000,
        },
      });
      const custB = await tenantBClient.customer.create({
        data: { organizationId: orgBId, name: 'Cliente B', phone: '11999990002' },
      });

      const startsAt1 = new Date('2026-10-12T10:00:00.000Z');
      const endsAt1 = new Date('2026-10-12T11:00:00.000Z');

      // 3. Primeira reserva na Empresa A (10:00 - 11:00)
      const aptA1 = await tenantAClient.appointment.create({
        data: {
          organizationId: orgAId,
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servA.id,
          startsAt: startsAt1,
          endsAt: endsAt1,
          status: 'SCHEDULED',
        },
      });
      expect(aptA1.id).toBeDefined();

      // 4. Segunda reserva para o mesmo profissional na Empresa A com sobreposição (10:30 - 11:30)
      const startsAtOverlapping = new Date('2026-10-12T10:30:00.000Z');
      const endsAtOverlapping = new Date('2026-10-12T11:30:00.000Z');

      await expect(
        tenantAClient.appointment.create({
          data: {
            organizationId: orgAId,
            customerId: custA.id,
            professionalId: profA.id,
            serviceId: servA.id,
            startsAt: startsAtOverlapping,
            endsAt: endsAtOverlapping,
            status: 'SCHEDULED',
          },
        }),
      ).rejects.toThrow(/no_overlapping_scheduled_appointments|exclusion|conflict|P2002|P2010/i);

      // 5. Reserva no mesmo horário na Empresa B (10:00 - 11:00) deve suceder sem conflito
      const aptB1 = await tenantBClient.appointment.create({
        data: {
          organizationId: orgBId,
          customerId: custB.id,
          professionalId: profB.id,
          serviceId: servB.id,
          startsAt: startsAt1,
          endsAt: endsAt1,
          status: 'SCHEDULED',
        },
      });
      expect(aptB1.id).toBeDefined();
    });
  });

  describe('Cenário 5: Integração HTTP End-to-End via buildApp', () => {
    it('isola operações HTTP de clientes e serviços de acordo com o JWT do tenant', async () => {
      const app = buildApp({
        jwtSecret,
        tenantDatabaseResolver: resolver,
      });

      try {
        const tokenA = signJwt(
          {
            id: 'user-a',
            organizationId: orgAId,
            role: 'OWNER',
            name: 'Proprietário A',
            email: 'a@empresa-a.test',
          },
          jwtSecret,
        );

        const tokenB = signJwt(
          {
            id: 'user-b',
            organizationId: orgBId,
            role: 'OWNER',
            name: 'Proprietário B',
            email: 'b@empresa-b.test',
          },
          jwtSecret,
        );

        const tokenC = signJwt(
          {
            id: 'user-c',
            organizationId: orgCId,
            role: 'OWNER',
            name: 'Proprietário C',
            email: 'c@empresa-c.test',
          },
          jwtSecret,
        );

        // 1. Cria cliente via API usando token da Empresa A
        const resCreateA = await app.inject({
          method: 'POST',
          url: '/customers',
          headers: { authorization: `Bearer ${tokenA}` },
          payload: { name: 'Cliente HTTP Empresa A', phone: '11988880001' },
        });
        expect(resCreateA.statusCode).toBe(201);
        const createdCustomerA = resCreateA.json().customer;

        // 2. Consulta clientes da Empresa A
        const resListA = await app.inject({
          method: 'GET',
          url: '/customers',
          headers: { authorization: `Bearer ${tokenA}` },
        });
        expect(resListA.statusCode).toBe(200);
        expect(resListA.json().customers).toHaveLength(1);
        expect(resListA.json().customers[0].name).toBe('Cliente HTTP Empresa A');

        // 3. Consulta clientes da Empresa B (deve vir vazia, sem dados de A)
        const resListB = await app.inject({
          method: 'GET',
          url: '/customers',
          headers: { authorization: `Bearer ${tokenB}` },
        });
        expect(resListB.statusCode).toBe(200);
        expect(resListB.json().customers).toHaveLength(0);

        // 4. Tentativa de injeção de organizationId fraudulento na query pelo Usuário B
        const resSpoof = await app.inject({
          method: 'GET',
          url: `/customers?organizationId=${orgAId}`,
          headers: { authorization: `Bearer ${tokenB}` },
        });
        expect(resSpoof.statusCode).toBe(200);
        expect(resSpoof.json().customers).toHaveLength(0);

        // 5. Requisição com tenant com status PROVISIONING retorna 503
        const resProvisioning = await app.inject({
          method: 'GET',
          url: '/customers',
          headers: { authorization: `Bearer ${tokenC}` },
        });
        expect(resProvisioning.statusCode).toBe(503);
        expect(resProvisioning.json().message).toMatch(/indisponível/i);

        // 6. Confirmação direta no banco: o cliente criado está somente em tenant_a_lab
        const inDbA = await tenantAClient.customer.findUnique({
          where: { id: createdCustomerA.id },
        });
        const inDbB = await tenantBClient.customer.findUnique({
          where: { id: createdCustomerA.id },
        });
        expect(inDbA).not.toBeNull();
        expect(inDbB).toBeNull();
      } finally {
        await app.close();
      }
    });
  });

  describe('Cenário 6: Encerramento Limpo e Ciclo de Vida de Conexões', () => {
    it('encerra conexões e bloqueia chamadas subsequentes após resolver.close()', async () => {
      const freshResolver = new DedicatedTenantDatabaseResolver(
        accountsDirectory(accountsClient),
        secretFor,
        createTenantClient,
        20,
      );

      const client = await freshResolver.resolve({
        organizationId: orgAId,
        userId: 'u1',
        role: 'OWNER',
      });
      const check1 = await client.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok;`;
      expect(check1[0].ok).toBe(1);

      await freshResolver.close();

      await expect(
        freshResolver.resolve({
          organizationId: orgAId,
          userId: 'u1',
          role: 'OWNER',
        }),
      ).rejects.toBeInstanceOf(TenantDatabaseUnavailableError);
    });
  });
});
