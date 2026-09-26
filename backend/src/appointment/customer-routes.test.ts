import type { Customer } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { signJwt, type AuthenticatedUser } from '../auth/jwt.js';
import { CustomerNotFoundError } from './customer.js';

const jwtSecret = 'jwt-secret-test-customer-routes';
const organizationA = '11111111-1111-4111-8111-111111111111';
const organizationB = '22222222-2222-4222-8222-222222222222';

const ownerA: AuthenticatedUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Owner da Empresa A',
  email: 'owner.a@example.com',
  role: 'OWNER',
  organizationId: organizationA,
};

const ownerB: AuthenticatedUser = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Owner da Empresa B',
  email: 'owner.b@example.com',
  role: 'OWNER',
  organizationId: organizationB,
};

function makeCustomer(
  id: string = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  organizationId: string = organizationA,
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id,
    organizationId,
    name: 'Cliente de Teste',
    phone: '11999999999',
    email: 'cliente@example.com',
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    updatedAt: new Date('2026-09-24T10:00:00.000Z'),
    ...overrides,
  };
}

describe('Rotas de Clientes (PATCH /customers/:id e GET /customers com busca)', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  function createApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
    const app = buildApp({ jwtSecret, ...overrides });
    apps.add(app);
    return app;
  }

  function auth(user: AuthenticatedUser = ownerA) {
    return { authorization: `Bearer ${signJwt(user, jwtSecret)}` };
  }

  describe('PATCH /customers/:id', () => {
    it('atualiza cliente com sucesso e retorna 200', async () => {
      let receivedId: string | undefined;
      let receivedInput: unknown;
      let receivedOrganizationId: string | undefined;

      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp({
        updateCustomer: async (id, input, organizationId) => {
          receivedId = id;
          receivedInput = input;
          receivedOrganizationId = organizationId;
          return {
            ...makeCustomer(id, organizationId),
            ...input,
            updatedAt: new Date('2026-09-25T12:00:00.000Z'),
          };
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {
          name: 'Nome Atualizado',
          phone: '11988887777',
          email: 'novo@email.com',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(receivedId).toBe(customerId);
      expect(receivedOrganizationId).toBe(organizationA);
      expect(receivedInput).toEqual({
        name: 'Nome Atualizado',
        phone: '11988887777',
        email: 'novo@email.com',
      });

      const body = response.json();
      expect(body.customer.name).toBe('Nome Atualizado');
      expect(body.customer.phone).toBe('11988887777');
      expect(body.customer.email).toBe('novo@email.com');
    });

    it('permite atualizar parcialmente campos permitidos', async () => {
      let receivedInput: unknown;
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp({
        updateCustomer: async (id, input, organizationId) => {
          receivedInput = input;
          return { ...makeCustomer(id, organizationId), ...input };
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {
          phone: '11977778888',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(receivedInput).toEqual({
        phone: '11977778888',
      });
    });

    it('retorna 400 para e-mail com formato inválido', async () => {
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp();

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {
          email: 'email-invalido',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/Dados de cliente inválidos/i);
      expect(response.json().issues).toHaveProperty('email');
    });

    it('retorna 400 para telefone inválido (menos de 8 caracteres)', async () => {
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp();

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {
          phone: '1234',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/Dados de cliente inválidos/i);
      expect(response.json().issues).toHaveProperty('phone');
    });

    it('retorna 400 para nome inválido (menos de 2 caracteres)', async () => {
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp();

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {
          name: 'A',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/Dados de cliente inválidos/i);
      expect(response.json().issues).toHaveProperty('name');
    });

    it('retorna 400 se nenhum campo for enviado para atualização', async () => {
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp();

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/Dados de cliente inválidos/i);
    });

    it('retorna 400 para ID com formato UUID inválido na rota', async () => {
      const app = createApp();

      const response = await app.inject({
        method: 'PATCH',
        url: '/customers/id-nao-uuid',
        headers: auth(ownerA),
        payload: {
          name: 'Novo Nome',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/Parâmetros de rota inválidos/i);
    });

    it('retorna 401 quando não autenticado', async () => {
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp();

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        payload: {
          name: 'Tentativa sem auth',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('retorna 404 quando o cliente não existir', async () => {
      const customerId = '00000000-0000-4000-8000-000000000000';
      const app = createApp({
        updateCustomer: async () => {
          throw new CustomerNotFoundError();
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}`,
        headers: auth(ownerA),
        payload: {
          name: 'Nome Teste',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toMatch(/Cliente não encontrado/i);
    });

    it('retorna 404 ao tentar atualizar cliente de outra organização (isolamento multitenant)', async () => {
      const customerIdFromOrgB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp({
        updateCustomer: async (_id, _input, organizationId) => {
          if (organizationId !== organizationB) {
            throw new CustomerNotFoundError('Cliente não encontrado na organização.');
          }
          return makeCustomer(customerIdFromOrgB, organizationB);
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerIdFromOrgB}`,
        headers: auth(ownerA),
        payload: {
          name: 'Tentativa de Hack',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toMatch(/Cliente não encontrado na organização/i);
    });

    it('nunca aceita organizationId enviado no payload para alterar o tenant de destino', async () => {
      let capturedOrgId: string | undefined;
      const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const app = createApp({
        updateCustomer: async (id, input, organizationId) => {
          capturedOrgId = organizationId;
          return { ...makeCustomer(id, organizationId), ...input };
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/customers/${customerId}?organizationId=${organizationB}`,
        headers: auth(ownerA),
        payload: {
          name: 'Nome Atualizado',
          organizationId: organizationB,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedOrgId).toBe(organizationA);
    });
  });

  describe('GET /customers com busca', () => {
    it('rejeita requisição não autenticada com 401', async () => {
      const app = createApp();
      const response = await app.inject({ method: 'GET', url: '/customers?search=teste' });
      expect(response.statusCode).toBe(401);
    });

    it('encaminha parâmetro de busca para o serviço mantendo organização do JWT', async () => {
      let receivedOrg: string | undefined;
      let receivedFilter: { search?: string } | undefined;

      const customer1 = makeCustomer('c1111111-1111-4111-8111-111111111111', organizationA, {
        name: 'Carlos Oliveira',
        phone: '11999991111',
        email: 'carlos@exemplo.com',
      });

      const app = createApp({
        listCustomers: async (organizationId, filter) => {
          receivedOrg = organizationId;
          receivedFilter = filter as { search?: string } | undefined;
          return [customer1];
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/customers?search=carlos&organizationId=' + organizationB,
        headers: auth(ownerA),
      });

      expect(response.statusCode).toBe(200);
      expect(receivedOrg).toBe(organizationA);
      expect(receivedFilter).toEqual({ search: 'carlos' });
      expect(response.json().customers).toHaveLength(1);
      expect(response.json().customers[0].name).toBe('Carlos Oliveira');
    });

    it('suporta parâmetro q alternativo para busca', async () => {
      let receivedFilter: { search?: string } | undefined;

      const app = createApp({
        listCustomers: async (_organizationId, filter) => {
          receivedFilter = filter as { search?: string } | undefined;
          return [];
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/customers?q=11988887777',
        headers: auth(ownerA),
      });

      expect(response.statusCode).toBe(200);
      expect(receivedFilter).toEqual({ search: '11988887777' });
    });

    it('isola busca entre organizações diferentes', async () => {
      const customersOrgA = [
        makeCustomer('c1111111-1111-4111-8111-111111111111', organizationA, {
          name: 'Renata Castro',
          phone: '11988881111',
          email: 'renata@empresa-a.com',
        }),
      ];
      const customersOrgB = [
        makeCustomer('c2222222-2222-4222-8222-222222222222', organizationB, {
          name: 'Renata B',
          phone: '11988882222',
          email: 'renata@empresa-b.com',
        }),
      ];

      const app = createApp({
        listCustomers: async (organizationId, filter) => {
          const list = organizationId === organizationA ? customersOrgA : customersOrgB;
          const search = filter && 'search' in filter ? filter.search?.toLowerCase() : undefined;
          if (!search) return list;
          return list.filter(
            (c) =>
              c.name.toLowerCase().includes(search) ||
              c.phone.toLowerCase().includes(search) ||
              (c.email && c.email.toLowerCase().includes(search)),
          );
        },
      });

      // Tenant A busca por 'empresa-b' -> deve retornar lista vazia
      const resA = await app.inject({
        method: 'GET',
        url: '/customers?search=empresa-b',
        headers: auth(ownerA),
      });
      expect(resA.statusCode).toBe(200);
      expect(resA.json().customers).toHaveLength(0);

      // Tenant B busca por 'empresa-b' -> retorna o cliente da Empresa B
      const resB = await app.inject({
        method: 'GET',
        url: '/customers?search=empresa-b',
        headers: auth(ownerB),
      });
      expect(resB.statusCode).toBe(200);
      expect(resB.json().customers).toHaveLength(1);
      expect(resB.json().customers[0].organizationId).toBe(organizationB);
    });
  });
});
