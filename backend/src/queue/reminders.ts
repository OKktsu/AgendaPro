import { Queue, Worker, UnrecoverableError, DelayedError } from 'bullmq';
import { z } from 'zod';
import { producerConnection, workerConnection, type QueueConfig } from './config.js';
import {
  markQueued,
  pendingReminders,
  processStoredReminder,
  type ReminderSql,
  ReminderNotDueError,
} from './reminder-store.js';

export const REMINDER_QUEUE = 'appointment-reminders';
export const reminderDataSchema = z
  .object({
    organizationId: z.string().uuid(),
    appointmentId: z.string().uuid(),
    reminderId: z.string().uuid(),
  })
  .strict();
export type ReminderData = z.infer<typeof reminderDataSchema>;
export type ReminderDatabases = {
  organizations(): Promise<string[]>;
  resolve(organizationId: string): Promise<ReminderSql | null>;
  close(): Promise<void>;
};

export function createReminderQueue(config: QueueConfig) {
  const queue = new Queue<ReminderData, string, 'reminder'>(REMINDER_QUEUE, {
    prefix: config.prefix,
    connection: {
      ...producerConnection(config),
      retryStrategy: workerConnection(config).retryStrategy,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 604800, count: 100 },
    },
  });
  queue.on('error', () => console.error('Lembretes: Redis indisponível.'));
  return queue;
}

export async function dispatchReminders(
  databases: ReminderDatabases,
  queue: Pick<ReturnType<typeof createReminderQueue>, 'add'>,
  onUnavailable: () => void = () =>
    console.error('Lembretes: base ou fila indisponível; pedido permanece no banco.'),
) {
  for (const organizationId of await databases.organizations()) {
    try {
      const db = await databases.resolve(organizationId);
      if (!db) continue;
      for (const row of await pendingReminders(db, organizationId)) {
        await queue.add(
          'reminder',
          {
            organizationId: row.organizationId,
            appointmentId: row.appointmentId,
            reminderId: row.id,
          },
          {
            jobId: row.id,
            delay: Math.max(0, row.dueAt.getTime() - Date.now()),
          },
        );
        await markQueued(db, row);
      }
    } catch {
      onUnavailable();
    }
  }
}

export async function processReminder(
  job: { name: string; data: unknown },
  databases: ReminderDatabases,
) {
  const parsed = reminderDataSchema.safeParse(job.data);
  if (job.name !== 'reminder' || !parsed.success)
    throw new UnrecoverableError('Lembrete inválido.');
  const data = parsed.data;
  // A base é resolvida pelo diretório confiável, nunca por URL/chave recebida no payload.
  const db = await databases.resolve(data.organizationId);
  if (!db) throw new Error('Base do lembrete indisponível.');
  return processStoredReminder(db, { ...data, id: data.reminderId });
}

export function createReminderWorker(config: QueueConfig, databases: ReminderDatabases) {
  const worker = new Worker(
    REMINDER_QUEUE,
    async (job, token) => {
      try {
        return await processReminder(job, databases);
      } catch (error) {
        if (!(error instanceof ReminderNotDueError)) throw error;
        await job.moveToDelayed(Date.now() + error.delayMs, token);
        throw new DelayedError();
      }
    },
    {
      prefix: config.prefix,
      connection: workerConnection(config),
      concurrency: config.concurrency,
    },
  );
  worker.on('error', () => console.error('Worker de lembretes: conexão indisponível.'));
  return worker;
}
