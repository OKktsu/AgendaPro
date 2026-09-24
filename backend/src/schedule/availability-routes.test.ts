import type {
  Appointment,
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
import type { AvailabilityDatabase } from './availability.js';

function createInMemoryAvailabilityDb(): AvailabilityDatabase & {
  professionals: Professional[];
  services: Service[];
  professionalServices: ProfessionalService[];
  schedules: ProfessionalWorkSchedule[];
  appointments: Appointment[];
} {
  const professionals: Professional[] = [];
  const services: Service[] = [];
  const professionalServices: ProfessionalService[] = [];
  const schedules: ProfessionalWorkSchedule[] = [];
  const appointments: Appointment[] = [];

  return {
    professionals,
    services,
    professionalServices,
    schedules,
    appointments,
    professional: {
      findFirst: async ({ where }: Prisma.ProfessionalFindFirstArgs) => {
        return (
          professionals.find(
            (p) => p.id === where?.id && p.organizationId === where?.organizationId,
          ) ?? null
        );
      },
    },
    service: {
      findFirst: async ({ where }: Prisma.ServiceFindFirstArgs) => {
        return (
          services.find((s) => s.id === where?.id && s.organizationId === where?.organizationId) ??
          null
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
        return schedules
          .filter((s) => s.professionalId === where?.professionalId && s.weekday === where?.weekday)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
      },
    },
    appointment: {
      findMany: async ({ where }: Prisma.AppointmentFindManyArgs) => {
        return appointments.filter(
          (a) =>
            (!where?.professionalId || a.professionalId === where.professionalId) &&
            (!where?.status || a.status === where.status),
        );
      },
    },
  };
}

describe('Rotas de Disponibilidade (GET /availability)', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();
  const jwtSecret = 'jwt-secret-test-availability';

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  const orgAId = '11111111-1111-4111-8111-111111111111';
  const orgBId = '22222222-2222-4222-8222-222222222222';

  const ownerA: AuthenticatedUser = {
    id: 'owner-a-uuid-1111-1111-111111111111',
    name: 'Dono Barbearia A',
    email: 'dono.a@barbearia.com',
    role: 'OWNER',
    organizationId: orgAId,
  };

  const staffA: AuthenticatedUser = {
    id: 'staff-a-uuid-1111-1111-111111111111',
    name: 'Atendente Barbearia A',
    email: 'staff.a@barbearia.com',
    role: 'STAFF',
    organizationId: orgAId,
  };

  const ownerB: AuthenticatedUser = {
    id: 'owner-b-uuid-2222-2222-222222222222',
    name: 'Dono Salão B',
    email: 'dono.b@salao.com',
    role: 'OWNER',
    organizationId: orgBId,
  };

  const profOrgA: Professional = {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Rodrigo Barbeiro',
    organizationId: orgAId,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const serviceCorteA: Service = {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Corte Cabelo 45 min',
    durationMinutes: 45,
    priceInCents: 5000,
    organizationId: orgAId,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const serviceBarbaA: Service = {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Barba 30 min (Não vinculada)',
    durationMinutes: 30,
    priceInCents: 3500,
    organizationId: orgAId,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const profOrgB: Professional = {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Beatriz Cabeleireira (Empresa B)',
    organizationId: orgBId,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const serviceOrgB: Service = {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Manicure (Empresa B)',
    durationMinutes: 40,
    priceInCents: 4500,
    organizationId: orgBId,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setupTestApp() {
    const db = createInMemoryAvailabilityDb();

    // Organização A
    db.professionals.push(profOrgA);
    db.services.push(serviceCorteA, serviceBarbaA);
    // Vínculo: profOrgA realiza serviceCorteA (mas NÃO realiza serviceBarbaA)
    db.professionalServices.push({
      professionalId: profOrgA.id,
      serviceId: serviceCorteA.id,
      createdAt: new Date(),
    });

    // Organização B
    db.professionals.push(profOrgB);
    db.services.push(serviceOrgB);
    db.professionalServices.push({
      professionalId: profOrgB.id,
      serviceId: serviceOrgB.id,
      createdAt: new Date(),
    });

    const app = buildApp({
      jwtSecret,
      availabilityDatabase: db,
    });
    apps.add(app);

    const tokenOwnerA = signJwt(ownerA, jwtSecret);
    const tokenStaffA = signJwt(staffA, jwtSecret);
    const tokenOwnerB = signJwt(ownerB, jwtSecret);

    return {
      app,
      db,
      tokenOwnerA,
      tokenStaffA,
      tokenOwnerB,
    };
  }

  it('calcula disponibilidade com intervalos de 15 min onde o serviço cabe na jornada (09:00-12:00, 45 min)', async () => {
    const { app, db, tokenOwnerA } = setupTestApp();

    // Quarta-feira: 2026-09-23
    db.schedules.push({
      id: 'sched-wed-1',
      professionalId: profOrgA.id,
      weekday: 'WEDNESDAY' as Weekday,
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.date).toBe('2026-09-23');
    expect(body.weekday).toBe('WEDNESDAY');
    expect(body.timezone).toBe('America/Sao_Paulo');
    expect(body.professionalId).toBe(profOrgA.id);
    expect(body.serviceId).toBe(serviceCorteA.id);

    // Horários esperados: 09:00 a 11:15
    const expectedSlots = [
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
    ];
    expect(body.slots).toEqual(expectedSlots);
    expect(body.availableSlots).toEqual(expectedSlots);
    // 11:30 não deve estar presente porque terminaria 12:15
    expect(body.slots).not.toContain('11:30');
  });

  it('permite que STAFF autenticado também consulte a disponibilidade da organização', async () => {
    const { app, db, tokenStaffA } = setupTestApp();

    db.schedules.push({
      id: 'sched-wed-1',
      professionalId: profOrgA.id,
      weekday: 'WEDNESDAY' as Weekday,
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenStaffA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.slots).toHaveLength(10);
  });

  it('dia sem expediente: retorna status 200 com slots vazio', async () => {
    const { app, tokenOwnerA } = setupTestApp();
    // Nenhuma jornada na quinta-feira 2026-09-24

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-24`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.weekday).toBe('THURSDAY');
    expect(body.slots).toEqual([]);
    expect(body.availableSlots).toEqual([]);
  });

  it('serviço que não cabe no fim da jornada: exclui horários além do fechamento', async () => {
    const { app, db, tokenOwnerA } = setupTestApp();

    // Sexta-feira: 2026-09-25 das 17:00 às 18:00 (1 hora de expediente)
    // Serviço tem 45 min
    db.schedules.push({
      id: 'sched-fri-1',
      professionalId: profOrgA.id,
      weekday: 'FRIDAY' as Weekday,
      startTime: '17:00',
      endTime: '18:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-25`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // 17:00 (termina 17:45 <= 18:00) -> OK
    // 17:15 (termina 18:00 <= 18:00) -> OK
    // 17:30 (terminaria 18:15 > 18:00) -> NÃO CABE
    expect(body.slots).toEqual(['17:00', '17:15']);
  });

  it('dois períodos no mesmo dia: gera horários para ambos e respeita o intervalo de almoço', async () => {
    const { app, db, tokenOwnerA } = setupTestApp();

    // Segunda-feira: 2026-09-28
    // Turno 1: 09:00 às 12:00
    // Turno 2: 13:00 às 18:00
    db.schedules.push(
      {
        id: 'sched-mon-1',
        professionalId: profOrgA.id,
        weekday: 'MONDAY' as Weekday,
        startTime: '09:00',
        endTime: '12:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'sched-mon-2',
        professionalId: profOrgA.id,
        weekday: 'MONDAY' as Weekday,
        startTime: '13:00',
        endTime: '18:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-28`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.weekday).toBe('MONDAY');

    // Manhã vai de 09:00 a 11:15
    expect(body.slots).toContain('09:00');
    expect(body.slots).toContain('11:15');

    // Intervalo de almoço: sem horários
    expect(body.slots).not.toContain('11:30');
    expect(body.slots).not.toContain('11:45');
    expect(body.slots).not.toContain('12:00');
    expect(body.slots).not.toContain('12:15');
    expect(body.slots).not.toContain('12:30');
    expect(body.slots).not.toContain('12:45');

    // Tarde vai de 13:00 a 17:15
    expect(body.slots).toContain('13:00');
    expect(body.slots).toContain('17:15');
    expect(body.slots).not.toContain('17:30');
  });

  it('serviço não vinculado ao profissional: retorna 400 Bad Request', async () => {
    const { app, tokenOwnerA } = setupTestApp();

    // serviceBarbaA pertence à Org A, mas não foi vinculado ao profOrgA
    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceBarbaA.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/não executa este serviço/i);
  });

  it('dados de outra organização recusados: retorna 404 (isolamento multitenant estrito)', async () => {
    const { app, tokenOwnerA, tokenOwnerB } = setupTestApp();

    // 1. Empresa A tenta consultar disponibilidade com profissional da Empresa B -> 404
    const resCrossProf = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgB.id}&serviceId=${serviceCorteA.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resCrossProf.statusCode).toBe(404);
    expect(JSON.parse(resCrossProf.payload).message).toContain('Profissional não encontrado');

    // 2. Empresa A tenta consultar disponibilidade com serviço da Empresa B -> 404
    const resCrossServ = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceOrgB.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resCrossServ.statusCode).toBe(404);
    expect(JSON.parse(resCrossServ.payload).message).toContain('Serviço não encontrado');

    // 3. Usuário tenta forçar organizationId malicioso na query -> ignorado, busca no tenant do token
    const resSpoof = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgB.id}&serviceId=${serviceOrgB.id}&date=2026-09-23&organizationId=${orgBId}`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    // Como o token pertence à Org A, profOrgB não existe na Org A -> 404
    expect(resSpoof.statusCode).toBe(404);

    // 4. Usuário legítimo da Empresa B consegue consultar seus próprios dados
    const resLegitB = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgB.id}&serviceId=${serviceOrgB.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerB}` },
    });
    expect(resLegitB.statusCode).toBe(200);
  });

  it('bloqueia requisição não autenticada com 401', async () => {
    const { app } = setupTestApp();

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-23`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('valida query params ausentes ou malformados com 400', async () => {
    const { app, tokenOwnerA } = setupTestApp();

    // Sem data
    const resNoDate = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resNoDate.statusCode).toBe(400);

    // UUID inválido
    const resBadUuid = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=invalido&serviceId=${serviceCorteA.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resBadUuid.statusCode).toBe(400);

    // Data com formato inválido
    const resBadFormat = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=23/09/2026`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resBadFormat.statusCode).toBe(400);

    // Data inexistente no calendário
    const resInvalidDate = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-02-31`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resInvalidDate.statusCode).toBe(400);
  });

  it('remove intervalos ocupados por reservas ativas na rota GET /availability', async () => {
    const { app, db, tokenOwnerA } = setupTestApp();

    db.schedules.push({
      id: 'sched-wed-1',
      professionalId: profOrgA.id,
      weekday: 'WEDNESDAY' as Weekday,
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Reserva 10:00 às 10:45
    db.appointments.push({
      id: 'apt-wed-1',
      organizationId: orgAId,
      customerId: 'cust-1',
      professionalId: profOrgA.id,
      serviceId: serviceCorteA.id,
      startsAt: new Date('2026-09-23T10:00:00-03:00'),
      endsAt: new Date('2026-09-23T10:45:00-03:00'),
      status: 'SCHEDULED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/availability?professionalId=${profOrgA.id}&serviceId=${serviceCorteA.id}&date=2026-09-23`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // 10:30 deve ter sido removido (conflitante)
    expect(body.availableSlots).not.toContain('10:30');
    expect(body.slots).not.toContain('10:30');

    // 09:15 e 10:45 encostam sem sobrepor e devem estar disponíveis
    expect(body.availableSlots).toContain('09:15');
    expect(body.availableSlots).toContain('10:45');
    expect(body.availableSlots).toEqual(['09:00', '09:15', '10:45', '11:00', '11:15']);
  });
});
