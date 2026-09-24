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
import { z } from 'zod';

import { prisma } from '../database/prisma.js';
import { SCHEDULE_DEFAULT_TIMEZONE, timeToMinutes } from '../schedule/availability.js';
import { CustomerNotFoundError } from './customer.js';

export function parseAppointmentDate(input: string | Date): Date {
  if (input instanceof Date) {
    return input;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    // Se não tiver indicador de timezone (Z ou offset +/-HH:mm),
    // assume o fuso horário padrão America/Sao_Paulo (-03:00)
    if (!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed)) {
      return new Date(`${trimmed}-03:00`);
    }
    return new Date(trimmed);
  }
  return new Date(input);
}

export function getDateTimePartsInTimezone(
  date: Date,
  timeZone: string = SCHEDULE_DEFAULT_TIMEZONE,
) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }
  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  const rawHour = (partMap.hour ?? '00').padStart(2, '0');
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = (partMap.minute ?? '00').padStart(2, '0');
  const weekday = (partMap.weekday ?? '').toUpperCase() as Weekday;
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hour}:${minute}`;

  return { dateStr, timeStr, weekday };
}

export const createAppointmentSchema = z.object({
  customerId: z.string().uuid('ID do cliente inválido.'),
  professionalId: z.string().uuid('ID do profissional inválido.'),
  serviceId: z.string().uuid('ID do serviço inválido.'),
  startsAt: z
    .string({
      required_error: 'O horário de início (startsAt) é obrigatório.',
      invalid_type_error: 'O horário de início deve ser uma string ISO 8601.',
    })
    .refine((val) => !isNaN(parseAppointmentDate(val).getTime()), {
      message: 'Data/horário de início inválido.',
    }),
});

export const appointmentParamsSchema = z.object({
  id: z.string().uuid('ID da reserva inválido.'),
});

export { CustomerNotFoundError };

export class ProfessionalNotFoundError extends Error {
  constructor(message: string = 'Profissional não encontrado na organização.') {
    super(message);
    this.name = 'ProfessionalNotFoundError';
  }
}

export class ServiceNotFoundError extends Error {
  constructor(message: string = 'Serviço não encontrado na organização.') {
    super(message);
    this.name = 'ServiceNotFoundError';
  }
}

export class ServiceNotProvidedByProfessionalError extends Error {
  constructor(message: string = 'O profissional selecionado não executa este serviço.') {
    super(message);
    this.name = 'ServiceNotProvidedByProfessionalError';
  }
}

export class AppointmentOutsideWorkScheduleError extends Error {
  constructor(
    message: string = 'O horário da reserva está fora da jornada de trabalho do profissional.',
  ) {
    super(message);
    this.name = 'AppointmentOutsideWorkScheduleError';
  }
}

export class AppointmentConflictError extends Error {
  constructor(
    message: string = 'Conflito de horário: já existe uma reserva agendada para este profissional no intervalo selecionado.',
  ) {
    super(message);
    this.name = 'AppointmentConflictError';
  }
}

export class AppointmentNotFoundError extends Error {
  constructor(message: string = 'Reserva não encontrada na organização.') {
    super(message);
    this.name = 'AppointmentNotFoundError';
  }
}

export type AppointmentDatabase = {
  customer: {
    findFirst: (args: Prisma.CustomerFindFirstArgs) => Promise<Customer | null>;
  };
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
  appointment: {
    create: (args: Prisma.AppointmentCreateArgs) => Promise<Appointment>;
    findFirst: (args: Prisma.AppointmentFindFirstArgs) => Promise<Appointment | null>;
    findMany: (args: Prisma.AppointmentFindManyArgs) => Promise<Appointment[]>;
    update: (args: Prisma.AppointmentUpdateArgs) => Promise<Appointment>;
  };
  $transaction?: <T>(fn: (tx: AppointmentDatabase) => Promise<T>) => Promise<T>;
};

export async function createAppointment(
  input: z.infer<typeof createAppointmentSchema>,
  organizationId: string,
  db: AppointmentDatabase = prisma,
): Promise<Appointment> {
  const [customer, professional, service] = await Promise.all([
    db.customer.findFirst({
      where: { id: input.customerId, organizationId },
    }),
    db.professional.findFirst({
      where: { id: input.professionalId, organizationId },
    }),
    db.service.findFirst({
      where: { id: input.serviceId, organizationId },
    }),
  ]);

  if (!customer) {
    throw new CustomerNotFoundError('Cliente não encontrado na organização.');
  }

  if (!professional) {
    throw new ProfessionalNotFoundError('Profissional não encontrado na organização.');
  }

  if (!service) {
    throw new ServiceNotFoundError('Serviço não encontrado na organização.');
  }

  const professionalService = await db.professionalService.findFirst({
    where: {
      professionalId: input.professionalId,
      serviceId: input.serviceId,
    },
  });

  if (!professionalService) {
    throw new ServiceNotProvidedByProfessionalError(
      'O profissional selecionado não executa este serviço.',
    );
  }

  const startsAt = parseAppointmentDate(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60 * 1000);

  // Verificar jornada de trabalho no fuso horário comercial
  const startParts = getDateTimePartsInTimezone(startsAt, SCHEDULE_DEFAULT_TIMEZONE);
  const endParts = getDateTimePartsInTimezone(endsAt, SCHEDULE_DEFAULT_TIMEZONE);

  if (startParts.dateStr !== endParts.dateStr) {
    throw new AppointmentOutsideWorkScheduleError(
      'O horário da reserva está fora da jornada de trabalho do profissional.',
    );
  }

  const schedules = await db.professionalWorkSchedule.findMany({
    where: {
      professionalId: input.professionalId,
      weekday: startParts.weekday,
    },
  });

  const startMinutes = timeToMinutes(startParts.timeStr);
  const endMinutes = timeToMinutes(endParts.timeStr);

  const isWithinShift = schedules.some((shift) => {
    const shiftStart = timeToMinutes(shift.startTime);
    const shiftEnd = timeToMinutes(shift.endTime);
    return shiftStart <= startMinutes && endMinutes <= shiftEnd;
  });

  if (!isWithinShift) {
    throw new AppointmentOutsideWorkScheduleError(
      'O horário da reserva está fora da jornada de trabalho do profissional.',
    );
  }

  const executeTx = db.$transaction
    ? (fn: (tx: AppointmentDatabase) => Promise<Appointment>) => db.$transaction!(fn)
    : (fn: (tx: AppointmentDatabase) => Promise<Appointment>) => fn(db);

  try {
    return await executeTx(async (tx: AppointmentDatabase) => {
      // Verificação em nível de aplicação (fast-path)
      const existingConflict = await tx.appointment.findFirst({
        where: {
          professionalId: input.professionalId,
          status: 'SCHEDULED',
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });

      if (existingConflict) {
        throw new AppointmentConflictError(
          'Conflito de horário: já existe uma reserva agendada para este profissional no intervalo selecionado.',
        );
      }

      return await tx.appointment.create({
        data: {
          organizationId,
          customerId: input.customerId,
          professionalId: input.professionalId,
          serviceId: input.serviceId,
          startsAt,
          endsAt,
          status: 'SCHEDULED',
        },
      });
    });
  } catch (error: unknown) {
    const err = error as {
      code?: string;
      meta?: { driverException?: { code?: string } };
      message?: string;
    };
    if (
      error instanceof AppointmentConflictError ||
      err?.code === '23P01' || // PostgreSQL exclusion_violation
      err?.code === 'P2004' || // Prisma: database constraint failed
      err?.code === 'P2002' || // Prisma: unique/exclusion violation
      err?.meta?.driverException?.code === '23P01' ||
      String(err?.message).includes('no_overlapping_scheduled_appointments') ||
      String(err?.message).includes('exclusion')
    ) {
      throw new AppointmentConflictError(
        'Conflito de horário: já existe uma reserva agendada para este profissional no intervalo selecionado.',
      );
    }
    throw error;
  }
}

export async function cancelAppointment(
  appointmentId: string,
  organizationId: string,
  db: AppointmentDatabase = prisma,
): Promise<Appointment> {
  const appointment = await db.appointment.findFirst({
    where: {
      id: appointmentId,
      organizationId,
    },
  });

  if (!appointment) {
    throw new AppointmentNotFoundError('Reserva não encontrada na organização.');
  }

  if (appointment.status === 'CANCELLED') {
    return appointment;
  }

  return await db.appointment.update({
    where: { id: appointmentId },
    data: {
      status: 'CANCELLED',
      updatedAt: new Date(),
    },
  });
}

export async function listAppointments(
  organizationId: string,
  filters: { professionalId?: string; customerId?: string } = {},
  db: AppointmentDatabase = prisma,
): Promise<Appointment[]> {
  return await db.appointment.findMany({
    where: {
      organizationId,
      ...(filters.professionalId ? { professionalId: filters.professionalId } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    orderBy: { startsAt: 'asc' },
  });
}
