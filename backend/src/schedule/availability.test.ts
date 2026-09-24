import type {
  Appointment,
  Prisma,
  Professional,
  ProfessionalService,
  ProfessionalWorkSchedule,
  Service,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  availabilityQuerySchema,
  calculateAvailableSlots,
  getAvailability,
  getWeekdayFromCalendarDate,
  isValidCalendarDate,
  minutesToTime,
  NotFoundError,
  SCHEDULE_DEFAULT_TIMEZONE,
  ServiceNotProvidedByProfessionalError,
  timeToMinutes,
  type AvailabilityDatabase,
} from './availability.js';

describe('Funções Puras de Disponibilidade', () => {
  describe('timeToMinutes e minutesToTime', () => {
    it('converte HH:mm para minutos desde a meia-noite', () => {
      expect(timeToMinutes('00:00')).toBe(0);
      expect(timeToMinutes('08:00')).toBe(480);
      expect(timeToMinutes('09:15')).toBe(555);
      expect(timeToMinutes('12:30')).toBe(750);
      expect(timeToMinutes('23:59')).toBe(1439);
    });

    it('converte minutos para string HH:mm formatada com zero à esquerda', () => {
      expect(minutesToTime(0)).toBe('00:00');
      expect(minutesToTime(480)).toBe('08:00');
      expect(minutesToTime(555)).toBe('09:15');
      expect(minutesToTime(750)).toBe('12:30');
      expect(minutesToTime(1439)).toBe('23:59');
    });

    it('é idempotente na conversão bidirecional', () => {
      const times = ['00:00', '09:00', '09:15', '13:45', '18:00', '22:30'];
      for (const t of times) {
        expect(minutesToTime(timeToMinutes(t))).toBe(t);
      }
    });
  });

  describe('isValidCalendarDate', () => {
    it('aceita datas válidas no formato YYYY-MM-DD', () => {
      expect(isValidCalendarDate('2026-09-23')).toBe(true);
      expect(isValidCalendarDate('2026-01-01')).toBe(true);
      expect(isValidCalendarDate('2026-12-31')).toBe(true);
      expect(isValidCalendarDate('2024-02-29')).toBe(true); // 2024 foi bissexto
    });

    it('rejeita formato diferente de YYYY-MM-DD', () => {
      expect(isValidCalendarDate('23/09/2026')).toBe(false);
      expect(isValidCalendarDate('2026/09/23')).toBe(false);
      expect(isValidCalendarDate('2026-9-23')).toBe(false);
      expect(isValidCalendarDate('texto')).toBe(false);
      expect(isValidCalendarDate('')).toBe(false);
    });

    it('rejeita datas inexistentes no calendário', () => {
      expect(isValidCalendarDate('2026-02-29')).toBe(false); // 2026 não é bissexto
      expect(isValidCalendarDate('2026-04-31')).toBe(false); // Abril tem 30 dias
      expect(isValidCalendarDate('2026-13-01')).toBe(false); // Mês 13 não existe
      expect(isValidCalendarDate('2026-00-10')).toBe(false); // Mês 0 não existe
      expect(isValidCalendarDate('2026-05-32')).toBe(false); // Dia 32 não existe
    });
  });

  describe('getWeekdayFromCalendarDate', () => {
    it('garante fuso horário explícito SCHEDULE_DEFAULT_TIMEZONE como America/Sao_Paulo', () => {
      expect(SCHEDULE_DEFAULT_TIMEZONE).toBe('America/Sao_Paulo');
    });

    it('retorna corretamente os dias da semana para datas de calendário', () => {
      expect(getWeekdayFromCalendarDate('2026-09-21')).toBe('MONDAY');
      expect(getWeekdayFromCalendarDate('2026-09-22')).toBe('TUESDAY');
      expect(getWeekdayFromCalendarDate('2026-09-23')).toBe('WEDNESDAY');
      expect(getWeekdayFromCalendarDate('2026-09-24')).toBe('THURSDAY');
      expect(getWeekdayFromCalendarDate('2026-09-25')).toBe('FRIDAY');
      expect(getWeekdayFromCalendarDate('2026-09-26')).toBe('SATURDAY');
      expect(getWeekdayFromCalendarDate('2026-09-27')).toBe('SUNDAY');
    });
  });

  describe('calculateAvailableSlots (Cálculo puro de horários)', () => {
    it('gera candidatos em intervalos de 15 min onde a duração total cabe na jornada (exemplo do escopo)', () => {
      // Jornada: 09:00–12:00, Serviço: 45 min
      const slots = calculateAvailableSlots({
        schedules: [{ startTime: '09:00', endTime: '12:00' }],
        serviceDurationMinutes: 45,
        intervalMinutes: 15,
      });

      expect(slots).toEqual([
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
      ]);
      // 11:15 + 45 min = 12:00 (cabe exatamente no fim da jornada)
      expect(slots).toContain('11:15');
      // 11:30 não é gerado pois terminaria às 12:15
      expect(slots).not.toContain('11:30');
    });

    it('dia sem expediente: retorna array vazio', () => {
      const slots = calculateAvailableSlots({
        schedules: [],
        serviceDurationMinutes: 30,
      });

      expect(slots).toEqual([]);
    });

    it('serviço que não cabe no fim da jornada: exclui horários que ultrapassam o fechamento', () => {
      // Jornada: 14:00–15:00 (60 min), Serviço: 45 min
      const slots = calculateAvailableSlots({
        schedules: [{ startTime: '14:00', endTime: '15:00' }],
        serviceDurationMinutes: 45,
      });

      // 14:00 termina 14:45 <= 15:00 (OK)
      // 14:15 termina 15:00 <= 15:00 (OK)
      // 14:30 terminaria 15:15 > 15:00 (REJEITADO)
      expect(slots).toEqual(['14:00', '14:15']);
    });

    it('serviço com duração maior que o período total: retorna array vazio', () => {
      // Período de 1 hora (09:00 às 10:00), serviço de 90 minutos
      const slots = calculateAvailableSlots({
        schedules: [{ startTime: '09:00', endTime: '10:00' }],
        serviceDurationMinutes: 90,
      });

      expect(slots).toEqual([]);
    });

    it('serviço com duração exatamente igual à janela da jornada: gera apenas o primeiro horário', () => {
      // Período de 60 min (10:00 às 11:00), serviço de 60 min
      const slots = calculateAvailableSlots({
        schedules: [{ startTime: '10:00', endTime: '11:00' }],
        serviceDurationMinutes: 60,
      });

      expect(slots).toEqual(['10:00']);
    });

    it('dois períodos no mesmo dia: respeita ambos os turnos e não gera horários no intervalo de almoço', () => {
      // Manhã: 09:00 às 12:00
      // Tarde: 13:00 às 18:00
      // Intervalo de almoço: 12:00 às 13:00
      // Serviço: 45 min
      const slots = calculateAvailableSlots({
        schedules: [
          { startTime: '09:00', endTime: '12:00' },
          { startTime: '13:00', endTime: '18:00' },
        ],
        serviceDurationMinutes: 45,
      });

      // Manhã: 09:00 até 11:15
      expect(slots.slice(0, 10)).toEqual([
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
      ]);

      // Nenhum horário pode cair no intervalo entre 11:30 e 12:45
      expect(slots).not.toContain('11:30');
      expect(slots).not.toContain('11:45');
      expect(slots).not.toContain('12:00');
      expect(slots).not.toContain('12:15');
      expect(slots).not.toContain('12:30');
      expect(slots).not.toContain('12:45');

      // Tarde recomeça pontualmente às 13:00 e vai até 17:15 (termina às 18:00)
      expect(slots[10]).toBe('13:00');
      expect(slots).toContain('17:15');
      expect(slots).not.toContain('17:30'); // 17:30 + 45 = 18:15 > 18:00
    });

    it('períodos passados fora de ordem são ordenados cronologicamente', () => {
      const slots = calculateAvailableSlots({
        schedules: [
          { startTime: '14:00', endTime: '16:00' },
          { startTime: '08:00', endTime: '10:00' },
        ],
        serviceDurationMinutes: 60,
      });

      expect(slots).toEqual([
        '08:00',
        '08:15',
        '08:30',
        '08:45',
        '09:00',
        '14:00',
        '14:15',
        '14:30',
        '14:45',
        '15:00',
      ]);
    });
  });

  describe('availabilityQuerySchema', () => {
    it('valida query params válidos', () => {
      const valid = availabilityQuerySchema.safeParse({
        professionalId: '11111111-1111-4111-8111-111111111111',
        serviceId: '22222222-2222-4222-8222-222222222222',
        date: '2026-09-23',
      });
      expect(valid.success).toBe(true);
    });

    it('rejeita UUID inválido para profissional e serviço', () => {
      const badProf = availabilityQuerySchema.safeParse({
        professionalId: 'invalido',
        serviceId: '22222222-2222-4222-8222-222222222222',
        date: '2026-09-23',
      });
      expect(badProf.success).toBe(false);

      const badServ = availabilityQuerySchema.safeParse({
        professionalId: '11111111-1111-4111-8111-111111111111',
        serviceId: 'invalido',
        date: '2026-09-23',
      });
      expect(badServ.success).toBe(false);
    });

    it('rejeita data inválida', () => {
      const badDate = availabilityQuerySchema.safeParse({
        professionalId: '11111111-1111-4111-8111-111111111111',
        serviceId: '22222222-2222-4222-8222-222222222222',
        date: '2026-02-30',
      });
      expect(badDate.success).toBe(false);
    });
  });
});

describe('Serviço getAvailability (Lógica de orquestração com banco em memória)', () => {
  const orgA = 'org-a-1111-1111-1111-111111111111';
  const orgB = 'org-b-2222-2222-2222-222222222222';

  const profA: Professional = {
    id: 'prof-a-1111-1111-1111-111111111111',
    name: 'Carlos Barbeiro',
    organizationId: orgA,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const serviceCorte: Service = {
    id: 'serv-corte-1111-1111-1111-111111111111',
    name: 'Corte Tradicional',
    durationMinutes: 45,
    priceInCents: 5000,
    organizationId: orgA,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const serviceBarba: Service = {
    id: 'serv-barba-2222-2222-2222-222222222222',
    name: 'Barba Terapia',
    durationMinutes: 30,
    priceInCents: 4000,
    organizationId: orgA,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function createMockDb(): AvailabilityDatabase & {
    schedules: ProfessionalWorkSchedule[];
    professionalServices: ProfessionalService[];
    appointments: Appointment[];
  } {
    const schedules: ProfessionalWorkSchedule[] = [];
    const professionalServices: ProfessionalService[] = [
      {
        professionalId: profA.id,
        serviceId: serviceCorte.id,
        createdAt: new Date(),
      },
    ];

    const appointments: Appointment[] = [];

    return {
      schedules,
      professionalServices,
      appointments,
      professional: {
        findFirst: async ({ where }: Prisma.ProfessionalFindFirstArgs) => {
          if (where?.id === profA.id && where?.organizationId === profA.organizationId) {
            return profA;
          }
          return null;
        },
      },
      service: {
        findFirst: async ({ where }: Prisma.ServiceFindFirstArgs) => {
          if (
            where?.id === serviceCorte.id &&
            where?.organizationId === serviceCorte.organizationId
          ) {
            return serviceCorte;
          }
          if (
            where?.id === serviceBarba.id &&
            where?.organizationId === serviceBarba.organizationId
          ) {
            return serviceBarba;
          }
          return null;
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

  it('calcula disponibilidade com sucesso para data e jornada cadastradas', async () => {
    const db = createMockDb();
    // Quarta-feira (2026-09-23)
    db.schedules.push({
      id: 'sched-1',
      professionalId: profA.id,
      weekday: 'WEDNESDAY',
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getAvailability(
      {
        professionalId: profA.id,
        serviceId: serviceCorte.id,
        date: '2026-09-23',
      },
      orgA,
      db,
    );

    expect(result.date).toBe('2026-09-23');
    expect(result.weekday).toBe('WEDNESDAY');
    expect(result.timezone).toBe('America/Sao_Paulo');
    expect(result.serviceDurationMinutes).toBe(45);
    expect(result.slots).toHaveLength(10);
    expect(result.slots[0]).toBe('09:00');
    expect(result.slots[9]).toBe('11:15');
    expect(result.availableSlots).toEqual(result.slots);
  });

  it('lança NotFoundError quando profissional não pertence à organização', async () => {
    const db = createMockDb();

    await expect(
      getAvailability(
        {
          professionalId: profA.id,
          serviceId: serviceCorte.id,
          date: '2026-09-23',
        },
        orgB, // Organização diferente
        db,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('lança NotFoundError quando serviço não pertence à organização', async () => {
    const db = createMockDb();

    await expect(
      getAvailability(
        {
          professionalId: profA.id,
          serviceId: 'serv-inexistente-1111-1111-111111111111',
          date: '2026-09-23',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('lança ServiceNotProvidedByProfessionalError quando profissional não realiza o serviço', async () => {
    const db = createMockDb();

    // serviceBarba pertence à orgA, mas não está vinculado ao profA
    await expect(
      getAvailability(
        {
          professionalId: profA.id,
          serviceId: serviceBarba.id,
          date: '2026-09-23',
        },
        orgA,
        db,
      ),
    ).rejects.toThrow(ServiceNotProvidedByProfessionalError);
  });

  it('retorna lista vazia de slots para dia sem expediente', async () => {
    const db = createMockDb();
    // Nenhuma jornada na segunda-feira (2026-09-21)

    const result = await getAvailability(
      {
        professionalId: profA.id,
        serviceId: serviceCorte.id,
        date: '2026-09-21', // Segunda-feira
      },
      orgA,
      db,
    );

    expect(result.weekday).toBe('MONDAY');
    expect(result.slots).toEqual([]);
    expect(result.availableSlots).toEqual([]);
  });

  it('remove horários ocupados por reservas ativas (10:00–10:45 remove 10:30, mas permite 09:15 e 10:45)', async () => {
    const db = createMockDb();
    // Expediente quarta-feira das 09:00 às 12:00
    db.schedules.push({
      id: 'sched-1',
      professionalId: profA.id,
      weekday: 'WEDNESDAY',
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Reserva ativa das 10:00 às 10:45
    db.appointments.push({
      id: 'apt-1',
      organizationId: orgA,
      customerId: 'cust-1',
      professionalId: profA.id,
      serviceId: serviceCorte.id,
      startsAt: new Date('2026-09-23T10:00:00-03:00'),
      endsAt: new Date('2026-09-23T10:45:00-03:00'),
      status: 'SCHEDULED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getAvailability(
      {
        professionalId: profA.id,
        serviceId: serviceCorte.id,
        date: '2026-09-23',
      },
      orgA,
      db,
    );

    // Slots originais seriam: 09:00, 09:15, 09:30, 09:45, 10:00, 10:15, 10:30, 10:45, 11:00, 11:15
    // Com reserva 10:00–10:45:
    // - 09:30 termina 10:15 (conflito -> removido)
    // - 09:45 termina 10:30 (conflito -> removido)
    // - 10:00 termina 10:45 (conflito -> removido)
    // - 10:15 termina 11:00 (conflito -> removido)
    // - 10:30 termina 11:15 (conflito -> removido)
    // Disponíveis restantes: 09:00, 09:15, 10:45, 11:00, 11:15
    expect(result.availableSlots).toEqual(['09:00', '09:15', '10:45', '11:00', '11:15']);
    expect(result.availableSlots).not.toContain('10:30');
    expect(result.availableSlots).toContain('10:45');
    expect(result.availableSlots).toContain('09:15');
    expect(result.slots).toEqual(result.availableSlots);
  });

  it('não remove horários para reservas com status CANCELLED', async () => {
    const db = createMockDb();
    db.schedules.push({
      id: 'sched-1',
      professionalId: profA.id,
      weekday: 'WEDNESDAY',
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Reserva cancelada
    db.appointments.push({
      id: 'apt-cancelled',
      organizationId: orgA,
      customerId: 'cust-1',
      professionalId: profA.id,
      serviceId: serviceCorte.id,
      startsAt: new Date('2026-09-23T10:00:00-03:00'),
      endsAt: new Date('2026-09-23T10:45:00-03:00'),
      status: 'CANCELLED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getAvailability(
      {
        professionalId: profA.id,
        serviceId: serviceCorte.id,
        date: '2026-09-23',
      },
      orgA,
      db,
    );

    expect(result.availableSlots).toContain('10:00');
    expect(result.availableSlots).toContain('10:30');
    expect(result.availableSlots).toHaveLength(10);
  });

  it('não remove horários quando a reserva é de outro profissional', async () => {
    const db = createMockDb();
    db.schedules.push({
      id: 'sched-1',
      professionalId: profA.id,
      weekday: 'WEDNESDAY',
      startTime: '09:00',
      endTime: '12:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Reserva de outro profissional
    db.appointments.push({
      id: 'apt-other-prof',
      organizationId: orgA,
      customerId: 'cust-1',
      professionalId: 'outro-prof-uuid',
      serviceId: serviceCorte.id,
      startsAt: new Date('2026-09-23T10:00:00-03:00'),
      endsAt: new Date('2026-09-23T10:45:00-03:00'),
      status: 'SCHEDULED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getAvailability(
      {
        professionalId: profA.id,
        serviceId: serviceCorte.id,
        date: '2026-09-23',
      },
      orgA,
      db,
    );

    expect(result.availableSlots).toContain('10:00');
    expect(result.availableSlots).toContain('10:30');
    expect(result.availableSlots).toHaveLength(10);
  });
});
