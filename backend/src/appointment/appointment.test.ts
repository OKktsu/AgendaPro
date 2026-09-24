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
import { describe, expect, it } from 'vitest';

import {
  cancelAppointment,
  createAppointment,
  parseAppointmentDate,
  AppointmentConflictError,
  AppointmentNotFoundError,
  AppointmentOutsideWorkScheduleError,
  CustomerNotFoundError,
  ProfessionalNotFoundError,
  ServiceNotFoundError,
  ServiceNotProvidedByProfessionalError,
  type AppointmentDatabase,
} from './appointment.js';
import { createCustomer, getCustomer, listCustomers, type CustomerDatabase } from './customer.js';

function createMockAppointmentDb(): AppointmentDatabase &
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
          id: (data.id as string | undefined) ?? `cust-${customers.length + 1}`,
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
        const item: Appointment = {
          id: (data.id as string | undefined) ?? `apt-${appointments.length + 1}`,
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
  };
}

describe('Domínio de Clientes (Customer)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  it('cria cliente associado à organização com sucesso', async () => {
    const db = createMockAppointmentDb();
    const customer = await createCustomer(
      {
        name: 'Carlos da Silva',
        phone: '11988887777',
        email: 'carlos@exemplo.com',
      },
      orgA,
      db,
    );

    expect(customer.id).toBeDefined();
    expect(customer.organizationId).toBe(orgA);
    expect(customer.name).toBe('Carlos da Silva');
    expect(customer.phone).toBe('11988887777');
    expect(customer.email).toBe('carlos@exemplo.com');
  });

  it('permite criar cliente sem email (opcional)', async () => {
    const db = createMockAppointmentDb();
    const customer = await createCustomer(
      {
        name: 'Ana Paula',
        phone: '11977776666',
        email: null,
      },
      orgA,
      db,
    );

    expect(customer.email).toBeNull();
  });

  it('isola listagem e busca de clientes por organização', async () => {
    const db = createMockAppointmentDb();
    await createCustomer({ name: 'Cliente A', phone: '111111111' }, orgA, db);
    const custB = await createCustomer({ name: 'Cliente B', phone: '222222222' }, orgB, db);

    const listA = await listCustomers(orgA, db);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe('Cliente A');

    await expect(getCustomer(custB.id, orgA, db)).rejects.toThrow(CustomerNotFoundError);
  });
});

describe('Domínio de Reservas (Appointment)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  function setupTestData(db: ReturnType<typeof createMockAppointmentDb>) {
    const custA: Customer = {
      id: 'cust-uuid-1',
      organizationId: orgA,
      name: 'João Pedro',
      phone: '11999998888',
      email: 'joao@teste.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.customers.push(custA);

    const profA: Professional = {
      id: 'prof-uuid-1',
      organizationId: orgA,
      name: 'Barbeiro Mestre',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.professionals.push(profA);

    const servCorte: Service = {
      id: 'serv-uuid-corte',
      organizationId: orgA,
      name: 'Corte Cabelo',
      durationMinutes: 45,
      priceInCents: 5000,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.services.push(servCorte);

    const servBarba: Service = {
      id: 'serv-uuid-barba',
      organizationId: orgA,
      name: 'Barba Terapia',
      durationMinutes: 30,
      priceInCents: 3500,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.services.push(servBarba);

    // Vínculo apenas do corte para o profA
    db.professionalServices.push({
      professionalId: profA.id,
      serviceId: servCorte.id,
      createdAt: new Date(),
    });

    // Jornada de quarta-feira (2026-09-23) das 09:00 às 18:00
    db.schedules.push({
      id: 'sched-wed-1',
      professionalId: profA.id,
      weekday: 'WEDNESDAY' as Weekday,
      startTime: '09:00',
      endTime: '18:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { custA, profA, servCorte, servBarba };
  }

  it('cria reserva com cálculo correto de endsAt baseado na duração do serviço', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA, servCorte } = setupTestData(db);

    // Quarta-feira 2026-09-23 às 10:00
    const startsAtStr = '2026-09-23T10:00:00-03:00';
    const appointment = await createAppointment(
      {
        customerId: custA.id,
        professionalId: profA.id,
        serviceId: servCorte.id,
        startsAt: startsAtStr,
      },
      orgA,
      db,
    );

    expect(appointment.id).toBeDefined();
    expect(appointment.organizationId).toBe(orgA);
    expect(appointment.customerId).toBe(custA.id);
    expect(appointment.professionalId).toBe(profA.id);
    expect(appointment.serviceId).toBe(servCorte.id);
    expect(appointment.status).toBe('SCHEDULED');

    // endsAt deve ser 45 min depois do início
    const expectedEnd = new Date(parseAppointmentDate(startsAtStr).getTime() + 45 * 60 * 1000);
    expect(appointment.endsAt.getTime()).toBe(expectedEnd.getTime());
  });

  it('rejeita cliente pertencente a outra organização (404)', async () => {
    const db = createMockAppointmentDb();
    const { profA, servCorte } = setupTestData(db);

    const custB: Customer = {
      id: 'cust-b-uuid',
      organizationId: orgB,
      name: 'Cliente B',
      phone: '11988887777',
      email: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.customers.push(custB);

    await expect(
      createAppointment(
        {
          customerId: custB.id,
          professionalId: profA.id,
          serviceId: servCorte.id,
          startsAt: '2026-09-23T10:00:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(CustomerNotFoundError);
  });

  it('rejeita profissional pertencente a outra organização (404)', async () => {
    const db = createMockAppointmentDb();
    const { custA, servCorte } = setupTestData(db);

    const profB: Professional = {
      id: 'prof-b-uuid',
      organizationId: orgB,
      name: 'Profissional B',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.professionals.push(profB);

    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profB.id,
          serviceId: servCorte.id,
          startsAt: '2026-09-23T10:00:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(ProfessionalNotFoundError);
  });

  it('rejeita serviço pertencente a outra organização (404)', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA } = setupTestData(db);

    const servB: Service = {
      id: 'serv-b-uuid',
      organizationId: orgB,
      name: 'Serviço B',
      durationMinutes: 30,
      priceInCents: 3000,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.services.push(servB);

    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servB.id,
          startsAt: '2026-09-23T10:00:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(ServiceNotFoundError);
  });

  it('rejeita serviço não vinculado ao profissional (400)', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA, servBarba } = setupTestData(db);

    // servBarba não foi vinculado a profA
    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servBarba.id,
          startsAt: '2026-09-23T10:00:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(ServiceNotProvidedByProfessionalError);
  });

  it('rejeita agendamento fora da jornada de trabalho (400)', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA, servCorte } = setupTestData(db);

    // 08:00 é antes do expediente (inicia às 09:00)
    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servCorte.id,
          startsAt: '2026-09-23T08:00:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(AppointmentOutsideWorkScheduleError);

    // 17:30 com 45 min terminaria 18:15 (após o fechamento 18:00)
    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servCorte.id,
          startsAt: '2026-09-23T17:30:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(AppointmentOutsideWorkScheduleError);

    // Quinta-feira (2026-09-24) sem expediente cadastrado
    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servCorte.id,
          startsAt: '2026-09-24T10:00:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(AppointmentOutsideWorkScheduleError);
  });

  it('impede criação de reserva sobreposta para o mesmo profissional (409)', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA, servCorte } = setupTestData(db);

    // Reserva das 10:00 às 10:45
    await createAppointment(
      {
        customerId: custA.id,
        professionalId: profA.id,
        serviceId: servCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
      orgA,
      db,
    );

    // Tentativa às 10:30 (sobrepõe 10:00–10:45) -> deve falhar com conflito
    await expect(
      createAppointment(
        {
          customerId: custA.id,
          professionalId: profA.id,
          serviceId: servCorte.id,
          startsAt: '2026-09-23T10:30:00-03:00',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(AppointmentConflictError);
  });

  it('permite reserva adjacente às 10:45 quando a anterior encerra às 10:45', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA, servCorte } = setupTestData(db);

    // Reserva 1: 10:00 às 10:45
    const apt1 = await createAppointment(
      {
        customerId: custA.id,
        professionalId: profA.id,
        serviceId: servCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
      orgA,
      db,
    );
    expect(apt1.id).toBeDefined();

    // Reserva 2: 10:45 às 11:30 (encosta perfeitamente no fim da anterior)
    const apt2 = await createAppointment(
      {
        customerId: custA.id,
        professionalId: profA.id,
        serviceId: servCorte.id,
        startsAt: '2026-09-23T10:45:00-03:00',
      },
      orgA,
      db,
    );
    expect(apt2.id).toBeDefined();
  });

  it('permite cancelar reserva e liberar o horário para novo agendamento', async () => {
    const db = createMockAppointmentDb();
    const { custA, profA, servCorte } = setupTestData(db);

    const apt = await createAppointment(
      {
        customerId: custA.id,
        professionalId: profA.id,
        serviceId: servCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
      orgA,
      db,
    );

    const cancelled = await cancelAppointment(apt.id, orgA, db);
    expect(cancelled.status).toBe('CANCELLED');

    // Agora é possível agendar novamente no mesmo horário (10:00)
    const newApt = await createAppointment(
      {
        customerId: custA.id,
        professionalId: profA.id,
        serviceId: servCorte.id,
        startsAt: '2026-09-23T10:00:00-03:00',
      },
      orgA,
      db,
    );
    expect(newApt.status).toBe('SCHEDULED');
  });

  it('cancelamento de reserva inexistente lança AppointmentNotFoundError (404)', async () => {
    const db = createMockAppointmentDb();
    setupTestData(db);

    await expect(
      cancelAppointment('id-inexistente-1111-1111-111111111111', orgA, db),
    ).rejects.toThrow(AppointmentNotFoundError);
  });
});
