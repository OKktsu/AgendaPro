import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { producerConnection, workerConnection, type QueueConfig } from './config.js';

export const PROBE_QUEUE = 'foundation-probe';
export const probeSchema = z.object({ runId: z.string().uuid() }).strict();
export type ProbeData = z.infer<typeof probeSchema>;
export type ProbeResult = { runId: string; processedAt: string };

export async function processProbe(job: { name: string; data: unknown }): Promise<ProbeResult> {
  const parsed = probeSchema.safeParse(job.data);
  if (job.name !== 'probe' || !parsed.success)
    throw new UnrecoverableError('Trabalho de teste inválido.');
  return { runId: parsed.data.runId, processedAt: new Date().toISOString() };
}

export function createProbeQueue(config: QueueConfig) {
  const queue = new Queue<ProbeData, ProbeResult, 'probe'>(PROBE_QUEUE, {
    prefix: config.prefix,
    connection: producerConnection(config),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 604800, count: 100 },
    },
  });
  // Evitar evento error sem listener. Não registrar mensagens de conexão que possam conter segredos.
  queue.on('error', () => console.error('Produtor: Redis indisponível.'));
  return queue;
}

export function createProbeWorker(config: QueueConfig) {
  const worker = new Worker<ProbeData, ProbeResult, 'probe'>(PROBE_QUEUE, processProbe, {
    prefix: config.prefix,
    connection: workerConnection(config),
    concurrency: config.concurrency,
  });
  worker.on('error', () => console.error('Worker: Redis indisponível; aguardando reconexão.'));
  return worker;
}
