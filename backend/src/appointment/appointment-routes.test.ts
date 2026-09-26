import type { Appointment, Customer } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { signJwt, type AuthenticatedUser } from '../auth/jwt.js';
import { AppointmentConflictError } from './appointment.js';

const jwtSecret = 'jwt-secret-test-appointment-routes';
const organizationA = '11111111-1111-4111-8111-111111111111';
const organizationB = '22222222-2222-4222-8222-222222222222';

const ownerA: AuthenticatedUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Owner da Empresa A',
  email: 'owner.a@example.com',
  role: 'OWNER',
  organizationId: organizationA,
};

function makeCustomer(organizationId: string = organizationA): Customer {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    organizationId,
    name: 'Cliente de Teste',
    phone: '11999999999',
    email: 'cliente@example.com',
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    updatedAt: new Date('2026-09-24T10:00:00.000Z'),
  };
}

function makeAppointment(organizationId: string = organizationA): Appointment {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    organizationId,
    customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    professionalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    serviceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    startsAt: new Date('2026-09-24T13:00:00.000Z'),
    endsAt: new Date('2026-09-24T13:45:00.000Z'),
    status: 'SCHEDULED',
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    updatedAt: new Date('2026-09-24T10:00:00.000Z'),
  };
}

describe('Rotas de Clientes e Reservas', () => {
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

  it('cria cliente usando exclusivamente a organização presente no JWT', async () => {
    let receivedOrganizationId: string | undefined;
    const app = createApp({
      createCustomer: async (input, organizationId) => {
        receivedOrganizationId = organizationId;
        return { ...makeCustomer(organizationId), ...input };
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/customers?organizationId=' + organizationB,
      headers: auth(),
      payload: {
        name: 'Cliente da Empresa A',
        phone: '11999999999',
        email: 'cliente.a@example.com',
        organizationId: organizationB,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedOrganizationId).toBe(organizationA);
    expect(response.json().customer.organizationId).toBe(organizationA);
  });

  it('lista clientes apenas da organização do token', async () => {
    let receivedOrganizationId: string | undefined;
    const customer = makeCustomer();
    const app = createApp({
      listCustomers: async (organizationId) => {
        receivedOrganizationId = organizationId;
        return [customer];
      },
    });

    const response = await app.inject({ method: 'GET', url: '/customers', headers: auth() });

    expect(response.statusCode).toBe(200);
    expect(receivedOrganizationId).toBe(organizationA);
    expect(response.json().customers).toHaveLength(1);
    expect(response.json().customers[0].organizationId).toBe(organizationA);
  });

  it('exige autenticação para acessar clientes', async () => {
    const app = createApp();

    const response = await app.inject({ method: 'GET', url: '/customers' });

    expect(response.statusCode).toBe(401);
  });

  it('cria reserva e encaminha dados válidos para o serviço da organização autenticada', async () => {
    let receivedOrganizationId: string | undefined;
    const appointment = makeAppointment();
    const app = createApp({
      createAppointment: async (_input, organizationId) => {
        receivedOrganizationId = organizationId;
        return { ...appointment, organizationId };
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: auth(),
      payload: {
        customerId: appointment.customerId,
        professionalId: appointment.professionalId,
        serviceId: appointment.serviceId,
        startsAt: '2026-09-24T10:00:00-03:00',
        organizationId: organizationB,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedOrganizationId).toBe(organizationA);
    expect(response.json().appointment.organizationId).toBe(organizationA);
  });

  it('lista reservas com filtros e sem permitir trocar de organização', async () => {
    let receivedOrganizationId: string | undefined;
    let receivedFilters:
      | { professionalId?: string; customerId?: string; startDate?: string; endDate?: string }
      | undefined;
    const appointment = makeAppointment();
    const app = createApp({
      listAppointments: async (organizationId, filters) => {
        receivedOrganizationId = organizationId;
        receivedFilters = filters;
        return [appointment];
      },
    });

    const response = await app.inject({
      method: 'GET',
      url:
        '/appointments?professionalId=' +
        appointment.professionalId +
        '&customerId=' +
        appointment.customerId +
        '&organizationId=' +
        organizationB,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(receivedOrganizationId).toBe(organizationA);
    expect(receivedFilters).toMatchObject({
      professionalId: appointment.professionalId,
      customerId: appointment.customerId,
    });
    expect(response.json().appointments).toHaveLength(1);
  });

  it('lista reservas com intervalo startDate e endDate válidos', async () => {
    let receivedFilters:
      | { professionalId?: string; customerId?: string; startDate?: string; endDate?: string }
      | undefined;
    const appointment = makeAppointment();
    const app = createApp({
      listAppointments: async (_organizationId, filters) => {
        receivedFilters = filters;
        return [appointment];
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/appointments?startDate=2026-09-21&endDate=2026-09-27',
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toMatchObject({
      startDate: '2026-09-21',
      endDate: '2026-09-27',
    });
    expect(response.json().appointments).toHaveLength(1);
  });

  it('rejeita listagem de reservas com formato de data inválido', async () => {
    let wasCalled = false;
    const app = createApp({
      listAppointments: async () => {
        wasCalled = true;
        return [];
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/appointments?startDate=data-invalida',
      headers: auth(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/Parâmetros de consulta inválidos/i);
    expect(response.json().issues.startDate).toBeDefined();
    expect(wasCalled).toBe(false);
  });

  it('rejeita listagem de reservas quando startDate for posterior a endDate', async () => {
    let wasCalled = false;
    const app = createApp({
      listAppointments: async () => {
        wasCalled = true;
        return [];
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/appointments?startDate=2026-09-28&endDate=2026-09-21',
      headers: auth(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/Parâmetros de consulta inválidos/i);
    expect(response.json().issues.endDate).toBeDefined();
    expect(wasCalled).toBe(false);
  });

  it('traduz conflito de horário em HTTP 409 para o frontend', async () => {
    const app = createApp({
      createAppointment: async () => {
        throw new AppointmentConflictError();
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: auth(),
      payload: {
        customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        professionalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        serviceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        startsAt: '2026-09-24T10:00:00-03:00',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/conflito de horário/i);
  });

  it('cancela reserva pela rota PATCH e preserva o isolamento por organização', async () => {
    let receivedId: string | undefined;
    let receivedOrganizationId: string | undefined;
    const cancelled = { ...makeAppointment(), status: 'CANCELLED' as const };
    const app = createApp({
      cancelAppointment: async (id, organizationId) => {
        receivedId = id;
        receivedOrganizationId = organizationId;
        return { ...cancelled, id, organizationId };
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/appointments/${cancelled.id}/cancel`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(receivedId).toBe(cancelled.id);
    expect(receivedOrganizationId).toBe(organizationA);
    expect(response.json().appointment.status).toBe('CANCELLED');
  });

  it('rejeita identificador inválido antes de tentar cancelar a reserva', async () => {
    let wasCalled = false;
    const app = createApp({
      cancelAppointment: async () => {
        wasCalled = true;
        return { ...makeAppointment(), status: 'CANCELLED' as const };
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/appointments/nao-e-um-uuid/cancel',
      headers: auth(),
    });

    expect(response.statusCode).toBe(400);
    expect(wasCalled).toBe(false);
  });
});
