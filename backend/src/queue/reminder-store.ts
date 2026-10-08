import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export type ReminderSql = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<number>;
};
export type ReminderRow = {
  id: string;
  organizationId: string;
  appointmentId: string;
  dueAt: Date;
};

export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export class ReminderNotDueError extends Error {
  constructor(readonly delayMs: number) {
    super('Lembrete ainda não está no horário de processamento.');
    this.name = 'ReminderNotDueError';
  }
}
export function reminderSchedule(startsAt: Date, now = new Date()) {
  return {
    dueAt: new Date(Math.max(now.getTime(), startsAt.getTime() - REMINDER_LEAD_MS)),
    status: startsAt <= now ? ('SKIPPED' as const) : ('PENDING' as const),
  };
}

/** Executar dentro da MESMA transação que cria a reserva; sem Redis no caminho HTTP. */
export async function recordReminder(
  db: Pick<ReminderSql, '$executeRaw'>,
  appointment: { id: string; organizationId: string; startsAt: Date },
  now = new Date(),
) {
  const plan = reminderSchedule(appointment.startsAt, now);
  await db.$executeRaw`
    INSERT INTO "ReminderOutbox" ("id", "organizationId", "appointmentId", "dueAt", "status", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${appointment.organizationId}::uuid, ${appointment.id}::uuid,
            ${plan.dueAt}, ${plan.status}::"ReminderStatus", ${now})`;
}

export async function cancelReminder(
  db: Pick<ReminderSql, '$executeRaw'>,
  organizationId: string,
  appointmentId: string,
) {
  await db.$executeRaw`
    UPDATE "ReminderOutbox" SET "status" = 'CANCELLED', "updatedAt" = NOW()
    WHERE "organizationId" = ${organizationId}::uuid AND "appointmentId" = ${appointmentId}::uuid
      AND "status" IN ('PENDING', 'QUEUED')`;
}

export async function pendingReminders(
  db: ReminderSql,
  organizationId: string,
): Promise<ReminderRow[]> {
  return db.$queryRaw<ReminderRow[]>`
    SELECT "id", "organizationId", "appointmentId", "dueAt" FROM "ReminderOutbox"
    WHERE "organizationId" = ${organizationId}::uuid
      AND ("status" = 'PENDING' OR ("status" = 'QUEUED' AND "dueAt" <= NOW()))
    ORDER BY CASE WHEN "status" = 'PENDING' THEN 0 ELSE 1 END, "updatedAt", "id" LIMIT 100`;
}

export async function markQueued(db: ReminderSql, row: ReminderRow) {
  // Não ressuscitar um trabalho que foi cancelado/processado durante queue.add().
  await db.$executeRaw`
    UPDATE "ReminderOutbox" SET "status" = 'QUEUED', "updatedAt" = NOW()
    WHERE "id" = ${row.id}::uuid AND "organizationId" = ${row.organizationId}::uuid
      AND "appointmentId" = ${row.appointmentId}::uuid AND "status" IN ('PENDING', 'QUEUED')`;
}

/** O efeito desta etapa é exclusivamente esta atualização atômica no PostgreSQL. */
export async function processStoredReminder(
  db: ReminderSql,
  row: Pick<ReminderRow, 'id' | 'organizationId' | 'appointmentId'>,
) {
  const processed = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "ReminderOutbox" AS r SET "status" = 'PROCESSED', "processedAt" = NOW(), "updatedAt" = NOW()
    FROM "Appointment" AS a
    WHERE r."id" = ${row.id}::uuid AND r."organizationId" = ${row.organizationId}::uuid
      AND r."appointmentId" = ${row.appointmentId}::uuid AND r."status" IN ('PENDING', 'QUEUED')
      AND r."dueAt" <= NOW() AND a."id" = r."appointmentId" AND a."organizationId" = r."organizationId"
      AND a."status" = 'SCHEDULED' AND a."startsAt" > NOW()
    RETURNING r."id"`;
  if (processed.length) return 'processed' as const;
  const early = await db.$queryRaw<Array<{ delayMs: number }>>`
    SELECT LEAST(60000, CEIL(EXTRACT(EPOCH FROM (r."dueAt" - NOW())) * 1000))::integer AS "delayMs"
    FROM "ReminderOutbox" AS r JOIN "Appointment" AS a
      ON a."id" = r."appointmentId" AND a."organizationId" = r."organizationId"
    WHERE r."id" = ${row.id}::uuid AND r."organizationId" = ${row.organizationId}::uuid
      AND r."appointmentId" = ${row.appointmentId}::uuid AND r."status" IN ('PENDING', 'QUEUED')
      AND r."dueAt" > NOW() AND a."status" = 'SCHEDULED' AND a."startsAt" > NOW()`;
  if (early.length) throw new ReminderNotDueError(Math.max(1000, early[0].delayMs));
  await db.$executeRaw`
    UPDATE "ReminderOutbox" AS r
    SET "status" = CASE WHEN a."status" = 'CANCELLED' THEN 'CANCELLED'::"ReminderStatus" ELSE 'SKIPPED'::"ReminderStatus" END,
        "updatedAt" = NOW()
    FROM "Appointment" AS a
    WHERE r."id" = ${row.id}::uuid AND r."organizationId" = ${row.organizationId}::uuid
      AND r."appointmentId" = ${row.appointmentId}::uuid AND r."status" IN ('PENDING', 'QUEUED')
      AND a."id" = r."appointmentId" AND a."organizationId" = r."organizationId"
      AND (a."status" = 'CANCELLED' OR a."startsAt" <= NOW())`;
  return 'skipped' as const;
}
