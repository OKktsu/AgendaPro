import type {
  Appointment,
  Customer,
  Prisma,
  Professional,
  ProfessionalService,
  ProfessionalWorkSchedule,
  Service,
  Weekday,
} from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { signJwt, type AuthenticatedUser } from '../auth/jwt.js';
import type { AppointmentDatabase } from './appointment.js';
import type { CustomerDatabase } from './customer.js';

function createConcurrencyTestDb(): AppointmentDatabase &
  CustomerDatabase & {
    customers: Customer[];
    professionals: Professional[];
    services: Service[];
    professionalServices: ProfessionalService[];
    schedules: ProfessionalWorkSchedule[];
    appointments: Appointment[];
  } {
  const customers: Customer[] = [];
  const professionals: Professional[] = [];
  const services: Service[] = [];
  const professionalServices: ProfessionalService[] = [];
  const schedules: ProfessionalWorkSchedule[] = [];
  const appointments: Appointment[] = [];

  return {
    customers,
    professionals,
    services,
    professionalServices,
    schedules,
    appointments,
    customer: {
      create: async ({ data }: Prisma.CustomerCreateArgs) => {
        const item: Customer = {
          id:
            (data.id as string | undefined) ??
            `c0000000-0000-4000-8000-${String(customers.length + 1).padStart(12, '0')}`,
          organizationId: data.organizationId as string,
          name: data.name as string,
          phone: data.phone as string,
          email: (data.email as string | null | undefined) ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        customers.push(item);
        return item;
      },
      findFirst: async ({ where }: Prisma.CustomerFindFirstArgs) => {
        return (
          customers.find(
            (c) =>
              (!where?.id || c.id === where.id) &&
              (!where?.organizationId || c.organizationId === where.organizationId),
          ) ?? null
        );
      },
      findMany: async ({ where }: Prisma.CustomerFindManyArgs) => {
        return customers.filter(
          (c) => !where?.organizationId || c.organizationId === where.organizationId,
        );
      },
      update: async ({ where, data }: Prisma.CustomerUpdateArgs) => {
        const index = customers.findIndex((c) => c.id === where.id);
        if (index === -1) {
          throw new Error('Record to update not found.');
        }
        const existing = customers[index];
        const updated: Customer = {
          ...existing,
          name: (data.name as string | undefined) ?? existing.name,
          phone: (data.phone as string | undefined) ?? existing.phone,
          email: data.email !== undefined ? (data.email as string | null) : existing.email,
          updatedAt: new Date(),
        };
        customers[index] = updated;
        return updated;
      },
    },
    professional: {
      findFirst: async ({ where }: Prisma.ProfessionalFindFirstArgs) => {
        return (
          professionals.find(
            (p) =>
              (!where?.id || p.id === where.id) &&
              (!where?.organizationId || p.organizationId === where.organizationId),
          ) ?? null
        );
      },
    },
    service: {
      findFirst: async ({ where }: Prisma.ServiceFindFirstArgs) => {
        return (
          services.find(
            (s) =>
              (!where?.id || s.id === where.id) &&
              (!where?.organizationId || s.organizationId === where.organizationId),
          ) ?? null
        );
      },
    },
    professionalService: {
      findFirst: async ({ where }: Prisma.ProfessionalServiceFindFirstArgs) => {
        return (
          professionalServices.find(
            (ps) =>
              ps.professionalId === where?.professionalId && ps.serviceId === where?.serviceId,
          ) ?? null
        );
      },
    },
    professionalWorkSchedule: {
      findMany: async ({ where }: Prisma.ProfessionalWorkScheduleFindManyArgs) => {
        return schedules.filter(
          (s) => s.professionalId === where?.professionalId && s.weekday === where?.weekday,
        );
      },
    },
    appointment: {
      create: async ({ data }: Prisma.AppointmentCreateArgs) => {
        // Simulação precisa da constraint de exclusão PostgreSQL:
        // EXCLUDE USING gist ("professionalId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&) WHERE ("status" = 'SCHEDULED')
        if (data.status === 'SCHEDULED') {
          const newStart = new Date(data.startsAt as string | Date).getTime();
          const newEnd = new Date(data.endsAt as string | Date).getTime();

          const hasOverlap = appointments.some((a) => {
            if (a.professionalId !== data.professionalId || a.status !== 'SCHEDULED') {
              return false;
            }
            const aStart = new Date(a.startsAt).getTime();
            const aEnd = new Date(a.endsAt).getTime();
            // Intervalo semiaberto [startsAt, endsAt)
            return newStart < aEnd && aStart < newEnd;
          });

          if (hasOverlap) {
            const error = new Error(
              'conflicting key value violates exclusion constraint "no_overlapping_scheduled_appointments"',
            ) as Error & { code: string };
            error.code = '23P01';
            throw error;
          }
        }

        const item: Appointment = {
          id:
            (data.id as string | undefined) ??
            `d0000000-0000-4000-8000-${String(appointments.length + 1).padStart(12, '0')}`,
          organizationId: data.organizationId as string,
          customerId: data.customerId as string,
          professionalId: data.professionalId as string,
          serviceId: data.serviceId as string,
          startsAt: new Date(data.startsAt as string | Date),
          endsAt: new Date(data.endsAt as string | Date),
          status: data.status ?? 'SCHEDULED',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        appointments.push(item);
        return item;
      },
      findFirst: async ({ where }: Prisma.AppointmentFindFirstArgs) => {
        return (
          appointments.find((a) => {
            if (where?.id && a.id !== where.id) return false;
            if (where?.organizationId && a.organizationId !== where.organizationId) return false;
            if (where?.professionalId && a.professionalId !== where.professionalId) return false;
            if (where?.status && a.status !== where.status) return false;
            const startsAtLt = where?.startsAt as { lt?: Date } | undefined;
            if (startsAtLt?.lt && !(a.startsAt < startsAtLt.lt)) return false;
            const endsAtGt = where?.endsAt as { gt?: Date } | undefined;
            if (endsAtGt?.gt && !(a.endsAt > endsAtGt.gt)) return false;
            return true;
          }) ?? null
        );
      },
      findMany: async ({ where }: Prisma.AppointmentFindManyArgs) => {
        return appointments.filter((a) => {
          if (where?.organizationId && a.organizationId !== where.organizationId) return false;
          if (where?.professionalId && a.professionalId !== where.professionalId) return false;
          if (where?.customerId && a.customerId !== where.customerId) return false;
          if (where?.status && a.status !== where.status) return false;
          return true;
        });
      },
      update: async ({ where, data }: Prisma.AppointmentUpdateArgs) => {
        const item = appointments.find((a) => a.id === where.id);
        if (!item) throw new Error('Not found');
        if (data.status) item.status = data.status as Appointment['status'];
        if (data.updatedAt) item.updatedAt = new Date();
        return item;
      },
    },
    $transaction: async <T>(fn: (tx: AppointmentDatabase) => Promise<T>): Promise<T> => {
      // Simula concorrência real intercalando chamadas de transações
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      const txMock: AppointmentDatabase = {
        customer: {
          findFirst: async () => null,
        },
        professional: {
          findFirst: async () => null,
        },
        service: {
          findFirst: async () => null,
        },
        professionalService: {
          findFirst: async () => null,
        },
        professionalWorkSchedule: {
          findMany: async () => [],
        },
        appointment: {
          findFirst: async ({ where }: Prisma.AppointmentFindFirstArgs) => {
            return (
              appointments.find((a) => {
                if (where?.professionalId && a.professionalId !== where.professionalId)
                  return false;
                if (where?.status && a.status !== where.status) return false;
                const startsAtLt = where?.startsAt as { lt?: Date } | undefined;
                if (startsAtLt?.lt && !(a.startsAt < startsAtLt.lt)) return false;
                const endsAtGt = where?.endsAt as { gt?: Date } | undefined;
                if (endsAtGt?.gt && !(a.endsAt > endsAtGt.gt)) return false;
                return true;
              }) ?? null
            );
          },
          findMany: async ({ where }: Prisma.AppointmentFindManyArgs) => {
            return appointments.filter((a) => {
              if (where?.organizationId && a.organizationId !== where.organizationId) return false;
              if (where?.professionalId && a.professionalId !== where.professionalId) return false;
              return true;
            });
          },
          update: async ({ where, data }: Prisma.AppointmentUpdateArgs) => {
            const item = appointments.find((a) => a.id === where.id);
            if (!item) throw new Error('Not found');
            if (data.status) item.status = data.status as Appointment['status'];
            if (data.updatedAt) item.updatedAt = new Date();
            return item;
          },
          create: async ({ data }: Prisma.AppointmentCreateArgs) => {
            // Chama a criação do repositório onde a constraint de exclusão é garantida
            if (data.status === 'SCHEDULED') {
              const newStart = new Date(data.startsAt as string | Date).getTime();
              const newEnd = new Date(data.endsAt as string | Date).getTime();

              const hasOverlap = appointments.some((a) => {
                if (a.professionalId !== data.professionalId || a.status !== 'SCHEDULED') {
                  return false;
                }
                const aStart = new Date(a.startsAt).getTime();
                const aEnd = new Date(a.endsAt).getTime();
                return newStart < aEnd && aStart < newEnd;
              });

              if (hasOverlap) {
                const error = new Error(
                  'conflicting key value violates exclusion constraint "no_overlapping_scheduled_appointments"',
                ) as Error & { code: string };
                error.code = '23P01';
                throw error;
              }
            }

            const item: Appointment = {
              id:
                (data.id as string | undefined) ??
                `d0000000-0000-4000-8000-${String(appointments.length + 1).padStart(12, '0')}`,
              organizationId: data.organizationId as string,
              customerId: data.customerId as string,
              professionalId: data.professionalId as string,
              serviceId: data.serviceId as string,
              startsAt: new Date(data.startsAt as string | Date),
              endsAt: new Date(data.endsAt as string | Date),
              status: data.status ?? 'SCHEDULED',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            appointments.push(item);
            return item;
          },
        },
      };
      return await fn(txMock);
    },
  };
}

describe('Testes de Integração e Concorrência de Reservas (POST /appointments)', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();
  const jwtSecret = 'jwt-secret-appointments-concurrency';

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  const orgAId = '11111111-1111-4111-8111-111111111111';
  const orgBId = '22222222-2222-4222-8222-222222222222';

  const userOwnerA: AuthenticatedUser = {
    id: 'aaaaaaaa-owner-4111-8111-111111111111',
    name: 'Proprietário Barbearia A',
    email: 'owner@barbearia.com',
    role: 'OWNER',
    organizationId: orgAId,
  };

  const userOwnerB: AuthenticatedUser = {
    id: 'bbbbbbbb-owner-4222-8222-222222222222',
    name: 'Proprietário Salão B',
    email: 'owner@salao.com',
    role: 'OWNER',
    organizationId: orgBId,
  };

  function setupApp() {
    const db = createConcurrencyTestDb();
    const tokenA = signJwt(userOwnerA, jwtSecret);
    const tokenB = signJwt(userOwnerB, jwtSecret);

    const app = buildApp({
      jwtSecret,
      appointmentDatabase: db,
      customerDatabase: db,
      availabilityDatabase: db,
    });
    apps.add(app);

    // Setup de dados comuns na Org A
    const customer1: Customer = {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      organizationId: orgAId,
      name: 'Cliente Um',
      phone: '11988887777',
      email: 'cliente1@teste.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const customer2: Customer = {
      id: 'aaaa2222-2222-4222-8222-222222222222',
      organizationId: orgAId,
      name: 'Cliente Dois',
      phone: '11977776666',
      email: 'cliente2@teste.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.customers.push(customer1, customer2);

    const prof1: Professional = {
      id: 'bbbb1111-1111-4111-8111-111111111111',
      organizationId: orgAId,
      name: 'Profissional Um',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prof2: Professional = {
      id: 'bbbb2222-2222-4222-8222-222222222222',
      organizationId: orgAId,
      name: 'Profissional Dois',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.professionals.push(prof1, prof2);

    const serviceCorte: Service = {
      id: 'cccc1111-1111-4111-8111-111111111111',
      organizationId: orgAId,
      name: 'Corte de Cabelo',
      durationMinutes: 45,
      priceInCents: 5000,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.services.push(serviceCorte);

    // Ambos os profissionais realizam o corte
    db.professionalServices.push(
      { professionalId: prof1.id, serviceId: serviceCorte.id, createdAt: new Date() },
      { professionalId: prof2.id, serviceId: serviceCorte.id, createdAt: new Date() },
    );

    // Horário de expediente na quarta-feira (2026-09-23) das 09:00 às 18:00 para ambos
    db.schedules.push(
      {
        id: 'sched-1',
        professionalId: prof1.id,
        weekday: 'WEDNESDAY' as Weekday,
        startTime: '09:00',
        endTime: '18:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'sched-2',
        professionalId: prof2.id,
        weekday: 'WEDNESDAY' as Weekday,
        startTime: '09:00',
        endTime: '18:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    return { app, db, tokenA, tokenB, customer1, customer2, prof1, prof2, serviceCorte };
  }

  it('duas requisições simultâneas para o mesmo profissional e horário: exatamente uma retorna 201 e a outra retorna 409', async () => {
    const { app, db, tokenA, customer1, customer2, prof1, serviceCorte } = setupApp();

    const requestPayload1 = {
      customerId: customer1.id,
      professionalId: prof1.id,
      serviceId: serviceCorte.id,
      startsAt: '2026-09-23T10:00:00-03:00',
    };

    const requestPayload2 = {
      customerId: customer2.id,
      professionalId: prof1.id,
      serviceId: serviceCorte.id,
      startsAt: '2026-09-23T10:00:00-03:00',
    };

    // Dispara duas requisições concorrentes em paralelo exato
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/appointments',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: requestPayload1,
      }),
      app.inject({
        method: 'POST',
        url: '/appointments',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: requestPayload2,
      }),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort();
    // Exatamente uma teve sucesso (201) e exatamente uma teve conflito (409)
    expect(statusCodes).toEqual([201, 409]);

    const errorResponse = res1.statusCode === 409 ? res1 : res2;
    const successResponse = res1.statusCode === 201 ? res1 : res2;

    const errorBody = JSON.parse(errorResponse.payload);
    expect(errorBody.message).toContain('Conflito de horário');

    const successBody = JSON.parse(successResponse.payload);
    expect(successBody.id).toBeDefined();
    expect(successBody.status).toBe('SCHEDULED');

    // Apenas uma reserva foi criada no banco
    expect(db.appointments).toHaveLength(1);
    expect(db.appointments[0].professionalId).toBe(prof1.id);
  });

  it('uma reserva de 10:00–10:45 impede outra às 10:30 para o mesmo profissional (409)', async () => {
    const { app, tokenA, customer1, customer2, prof1, serviceCorte } = setupApp();

    // Primeira reserva: 10:00 às 10:45
    const res1 = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customer1.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
    });
    expect(res1.statusCode).toBe(201);

    // Tentativa às 10:30 (sobrepõe o intervalo 10:00–10:45)
    const res2 = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customer2.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:30:00-03:00',
      },
    });

    expect(res2.statusCode).toBe(409);
    const body = JSON.parse(res2.payload);
    expect(body.message).toContain('Conflito de horário');
  });

  it('uma reserva às 10:45 é permitida pois encosta no fim da anterior sem sobrepor (201)', async () => {
    const { app, tokenA, customer1, customer2, prof1, serviceCorte } = setupApp();

    // Reserva 1: 10:00 às 10:45
    const res1 = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customer1.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
    });
    expect(res1.statusCode).toBe(201);

    // Reserva 2: 10:45 às 11:30 (adjacente, não sobrepõe)
    const res2 = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customer2.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:45:00-03:00',
      },
    });
    expect(res2.statusCode).toBe(201);
  });

  it('dois profissionais diferentes podem ser reservados no mesmo horário (ambos 201)', async () => {
    const { app, tokenA, customer1, customer2, prof1, prof2, serviceCorte } = setupApp();

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/appointments',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          customerId: customer1.id,
          professionalId: prof1.id,
          serviceId: serviceCorte.id,
          startsAt: '2026-09-23T10:00:00-03:00',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/appointments',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          customerId: customer2.id,
          professionalId: prof2.id, // Profissional diferente
          serviceId: serviceCorte.id,
          startsAt: '2026-09-23T10:00:00-03:00',
        },
      }),
    ]);

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
  });

  it('isolamento multitenant: dados de organizações diferentes permanecem estritamente isolados', async () => {
    const { app, tokenB, customer1, prof1, serviceCorte } = setupApp();

    // Usuário da Org B tentando criar reserva usando entidades da Org A
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        customerId: customer1.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('cancelamento de reserva libera o horário ocupado para novo agendamento', async () => {
    const { app, tokenA, customer1, prof1, serviceCorte } = setupApp();

    // Cria agendamento das 10:00 às 10:45
    const resCreate = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customer1.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
    });
    expect(resCreate.statusCode).toBe(201);
    const appointmentId = JSON.parse(resCreate.payload).id;

    // Cancela o agendamento
    const resCancel = await app.inject({
      method: 'PATCH',
      url: `/appointments/${appointmentId}/cancel`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(resCancel.statusCode).toBe(200);
    const cancelBody = JSON.parse(resCancel.payload);
    expect(cancelBody.status).toBe('CANCELLED');

    // Agora deve permitir criar uma nova reserva no mesmo horário (10:00)
    const resNew = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customer1.id,
        professionalId: prof1.id,
        serviceId: serviceCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
    });
    expect(resNew.statusCode).toBe(201);
  });
});
