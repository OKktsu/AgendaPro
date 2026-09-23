import type {
  Prisma,
  Professional,
  ProfessionalService,
  ProfessionalWorkSchedule,
  Service,
  Weekday,
} from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';

/**
 * Fuso horário padrão assumido para as operações da agenda.
 * Em sistemas de agendamento locais, as datas de calendário (YYYY-MM-DD)
 * e os horários de início e término das jornadas de trabalho são
 * interpretados no contexto do fuso horário comercial da organização.
 */
export const SCHEDULE_DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Valida se uma string representa uma data de calendário gregoriana real no formato YYYY-MM-DD.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Converte uma data de calendário no formato YYYY-MM-DD para o dia da semana correspondente
 * (Weekday do Prisma: MONDAY, TUESDAY, etc.) utilizando a API nativa Intl.DateTimeFormat
 * no fuso horário explicitado.
 */
export function getWeekdayFromCalendarDate(
  dateStr: string,
  timeZone: string = SCHEDULE_DEFAULT_TIMEZONE,
): Weekday {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Utilizar o meio-dia UTC (12:00:00 UTC) evita que pequenas diferenças de fuso
  // ou início/fim de horário de verão desloquem o dia do calendário.
  const dateAtNoonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone,
  });

  const weekdayName = formatter.format(dateAtNoonUtc).toUpperCase();
  return weekdayName as Weekday;
}

/**
 * Converte string no formato HH:mm para total de minutos desde 00:00.
 */
export function timeToMinutes(time: string): number {
  const [hoursStr, minutesStr] = time.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  return hours * 60 + minutes;
}

/**
 * Converte total de minutos para string no formato HH:mm.
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export interface CalculateAvailableSlotsParams {
  schedules: Array<{ startTime: string; endTime: string }>;
  serviceDurationMinutes: number;
  intervalMinutes?: number;
}

/**
 * Função pura que calcula os horários possíveis para atendimento em intervalos regulares (padrão: 15 min).
 * Cada horário candidato deve acomodar a duração inteira do serviço dentro de um mesmo período contínuo da jornada.
 *
 * Exemplo: jornada 09:00–12:00 e serviço de 45 min:
 * 09:00, 09:15, 09:30 ... 11:15 são válidos;
 * 11:30 não é gerado porque terminaria às 12:15.
 */
export function calculateAvailableSlots({
  schedules,
  serviceDurationMinutes,
  intervalMinutes = 15,
}: CalculateAvailableSlotsParams): string[] {
  if (!schedules || schedules.length === 0 || serviceDurationMinutes <= 0 || intervalMinutes <= 0) {
    return [];
  }

  // Ordena os períodos do dia de forma cronológica pelo horário inicial
  const sortedSchedules = [...schedules].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const candidateSlots: string[] = [];

  for (const schedule of sortedSchedules) {
    const shiftStart = timeToMinutes(schedule.startTime);
    const shiftEnd = timeToMinutes(schedule.endTime);

    // Garante alinhamento ao passo de minutos
    let slotStart = Math.ceil(shiftStart / intervalMinutes) * intervalMinutes;

    // O serviço precisa caber integralmente dentro do expediente deste período
    while (slotStart + serviceDurationMinutes <= shiftEnd) {
      candidateSlots.push(minutesToTime(slotStart));
      slotStart += intervalMinutes;
    }
  }

  // Retorna slots únicos preservando a ordenação cronológica
  return Array.from(new Set(candidateSlots));
}

export const availabilityQuerySchema = z.object({
  professionalId: z.string().uuid('ID do profissional inválido.'),
  serviceId: z.string().uuid('ID do serviço inválido.'),
  date: z
    .string({
      required_error: 'A data é obrigatória.',
      invalid_type_error: 'A data deve ser uma string no formato YYYY-MM-DD.',
    })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido. Use YYYY-MM-DD.')
    .refine((val) => isValidCalendarDate(val), {
      message: 'Data de calendário inválida.',
    }),
});

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ServiceNotProvidedByProfessionalError extends Error {
  constructor(message: string = 'O profissional selecionado não executa este serviço.') {
    super(message);
    this.name = 'ServiceNotProvidedByProfessionalError';
  }
}

export type AvailabilityDatabase = {
  professional: {
    findFirst: (args: Prisma.ProfessionalFindFirstArgs) => Promise<Professional | null>;
  };
  service: {
    findFirst: (args: Prisma.ServiceFindFirstArgs) => Promise<Service | null>;
  };
  professionalService: {
    findFirst: (
      args: Prisma.ProfessionalServiceFindFirstArgs,
    ) => Promise<ProfessionalService | null>;
  };
  professionalWorkSchedule: {
    findMany: (
      args: Prisma.ProfessionalWorkScheduleFindManyArgs,
    ) => Promise<ProfessionalWorkSchedule[]>;
  };
};

export interface AvailabilityResult {
  date: string;
  weekday: Weekday;
  timezone: string;
  professionalId: string;
  serviceId: string;
  serviceDurationMinutes: number;
  slots: string[];
  availableSlots: string[];
}

export async function getAvailability(
  query: z.infer<typeof availabilityQuerySchema>,
  organizationId: string,
  db: AvailabilityDatabase = prisma,
): Promise<AvailabilityResult> {
  const professional = await db.professional.findFirst({
    where: {
      id: query.professionalId,
      organizationId,
    },
  });

  if (!professional) {
    throw new NotFoundError('Profissional não encontrado na organização.');
  }

  const service = await db.service.findFirst({
    where: {
      id: query.serviceId,
      organizationId,
    },
  });

  if (!service) {
    throw new NotFoundError('Serviço não encontrado na organização.');
  }

  const professionalService = await db.professionalService.findFirst({
    where: {
      professionalId: query.professionalId,
      serviceId: query.serviceId,
    },
  });

  if (!professionalService) {
    throw new ServiceNotProvidedByProfessionalError(
      'O profissional selecionado não executa este serviço.',
    );
  }

  const weekday = getWeekdayFromCalendarDate(query.date, SCHEDULE_DEFAULT_TIMEZONE);

  const schedules = await db.professionalWorkSchedule.findMany({
    where: {
      professionalId: query.professionalId,
      weekday,
    },
    orderBy: { startTime: 'asc' },
  });

  const slots = calculateAvailableSlots({
    schedules,
    serviceDurationMinutes: service.durationMinutes,
    intervalMinutes: 15,
  });

  return {
    date: query.date,
    weekday,
    timezone: SCHEDULE_DEFAULT_TIMEZONE,
    professionalId: query.professionalId,
    serviceId: query.serviceId,
    serviceDurationMinutes: service.durationMinutes,
    slots,
    availableSlots: slots,
  };
}
