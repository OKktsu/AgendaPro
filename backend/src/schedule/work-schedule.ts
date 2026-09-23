import type { Prisma, Professional, ProfessionalWorkSchedule, Weekday } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type { Weekday };

const weekdayAliasMap: Record<string, Weekday> = {
  monday: 'MONDAY',
  segunda: 'MONDAY',
  'segunda-feira': 'MONDAY',
  'segunda feira': 'MONDAY',
  seg: 'MONDAY',

  tuesday: 'TUESDAY',
  terca: 'TUESDAY',
  terça: 'TUESDAY',
  'terca-feira': 'TUESDAY',
  'terça-feira': 'TUESDAY',
  'terca feira': 'TUESDAY',
  'terça feira': 'TUESDAY',
  ter: 'TUESDAY',

  wednesday: 'WEDNESDAY',
  quarta: 'WEDNESDAY',
  'quarta-feira': 'WEDNESDAY',
  'quarta feira': 'WEDNESDAY',
  qua: 'WEDNESDAY',

  thursday: 'THURSDAY',
  quinta: 'THURSDAY',
  'quinta-feira': 'THURSDAY',
  'quinta feira': 'THURSDAY',
  qui: 'THURSDAY',

  friday: 'FRIDAY',
  sexta: 'FRIDAY',
  'sexta-feira': 'FRIDAY',
  'sexta feira': 'FRIDAY',
  sex: 'FRIDAY',

  saturday: 'SATURDAY',
  sabado: 'SATURDAY',
  sábado: 'SATURDAY',
  sab: 'SATURDAY',
  sáb: 'SATURDAY',

  sunday: 'SUNDAY',
  domingo: 'SUNDAY',
  dom: 'SUNDAY',
};

export const weekdaySchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if (weekdayAliasMap[normalized]) {
        return weekdayAliasMap[normalized];
      }
      const upper = val.trim().toUpperCase();
      if (WEEKDAYS.includes(upper as Weekday)) {
        return upper;
      }
    }
    return val;
  },
  z.enum(WEEKDAYS, {
    errorMap: () => ({ message: 'Dia da semana inválido.' }),
  }),
);

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeStringSchema = z
  .string({
    required_error: 'O horário é obrigatório.',
    invalid_type_error: 'O horário deve ser uma string no formato HH:mm.',
  })
  .trim()
  .regex(TIME_REGEX, 'Formato de horário inválido. Use o formato HH:mm (ex: 09:00).');

export const createWorkScheduleSchema = z
  .object({
    weekday: weekdaySchema,
    startTime: timeStringSchema,
    endTime: timeStringSchema,
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'O horário de início deve ser anterior ao horário de término.',
    path: ['endTime'],
  });

export const professionalParamsSchema = z.object({
  professionalId: z.string().uuid('ID do profissional inválido.'),
});

export const deleteWorkScheduleParamsSchema = z.object({
  id: z.string().uuid('ID do horário de trabalho inválido.'),
});

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ScheduleConflictError extends Error {
  constructor(
    message: string = 'Já existe um horário de trabalho conflitante ou sobreposto para este profissional neste dia.',
  ) {
    super(message);
    this.name = 'ScheduleConflictError';
  }
}

export function isTimeOverlapping(
  slot1: { startTime: string; endTime: string },
  slot2: { startTime: string; endTime: string },
): boolean {
  return slot1.startTime < slot2.endTime && slot2.startTime < slot1.endTime;
}

export type WorkScheduleDatabase = {
  professional: {
    findFirst: (args: Prisma.ProfessionalFindFirstArgs) => Promise<Professional | null>;
  };
  professionalWorkSchedule: {
    create: (
      args: Prisma.ProfessionalWorkScheduleCreateArgs,
    ) => Promise<ProfessionalWorkSchedule>;
    findMany: (
      args: Prisma.ProfessionalWorkScheduleFindManyArgs,
    ) => Promise<ProfessionalWorkSchedule[]>;
    findFirst: (
      args: Prisma.ProfessionalWorkScheduleFindFirstArgs,
    ) => Promise<ProfessionalWorkSchedule | null>;
    delete: (
      args: Prisma.ProfessionalWorkScheduleDeleteArgs,
    ) => Promise<ProfessionalWorkSchedule>;
  };
};

export async function createWorkSchedule(
  input: z.infer<typeof createWorkScheduleSchema>,
  professionalId: string,
  organizationId: string,
  db: WorkScheduleDatabase = prisma,
) {
  const professional = await db.professional.findFirst({
    where: {
      id: professionalId,
      organizationId,
    },
  });

  if (!professional) {
    throw new NotFoundError('Profissional não encontrado na organização.');
  }

  const existingSchedules = await db.professionalWorkSchedule.findMany({
    where: {
      professionalId,
      weekday: input.weekday,
    },
  });

  const hasConflict = existingSchedules.some((existing) =>
    isTimeOverlapping(
      { startTime: input.startTime, endTime: input.endTime },
      { startTime: existing.startTime, endTime: existing.endTime },
    ),
  );

  if (hasConflict) {
    throw new ScheduleConflictError(
      'Já existe um horário de trabalho conflitante ou sobreposto para este profissional neste dia.',
    );
  }

  return await db.professionalWorkSchedule.create({
    data: {
      professionalId,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
    },
  });
}

export async function listWorkSchedules(
  professionalId: string,
  organizationId: string,
  db: WorkScheduleDatabase = prisma,
) {
  const professional = await db.professional.findFirst({
    where: {
      id: professionalId,
      organizationId,
    },
  });

  if (!professional) {
    throw new NotFoundError('Profissional não encontrado na organização.');
  }

  return await db.professionalWorkSchedule.findMany({
    where: {
      professionalId,
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
}

export async function deleteWorkSchedule(
  id: string,
  organizationId: string,
  db: WorkScheduleDatabase = prisma,
) {
  const schedule = await db.professionalWorkSchedule.findFirst({
    where: { id },
  });

  if (!schedule) {
    throw new NotFoundError('Horário de trabalho não encontrado na organização.');
  }

  const professional = await db.professional.findFirst({
    where: {
      id: schedule.professionalId,
      organizationId,
    },
  });

  if (!professional) {
    throw new NotFoundError('Horário de trabalho não encontrado na organização.');
  }

  return await db.professionalWorkSchedule.delete({
    where: { id },
  });
}
