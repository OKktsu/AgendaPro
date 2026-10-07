import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { QueueEvents } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { readQueueConfig, workerConnection } from './config.js';
import { createProbeQueue, createProbeWorker, PROBE_QUEUE } from './probe.js';

describe.skipIf(process.env.QUEUE_INTEGRATION !== '1')('fila real em Redis descartável', () => {
  const config = readQueueConfig();
  it('guarda trabalho sem worker e processa quando o worker inicia', async () => {
    const queue = createProbeQueue(config);
    const events = new QueueEvents(PROBE_QUEUE, {
      prefix: config.prefix,
      connection: workerConnection(config),
    });
    let worker: ReturnType<typeof createProbeWorker> | undefined;
    try {
      await queue.waitUntilReady();
      await events.waitUntilReady();
      const runId = randomUUID();
      const job = await queue.add('probe', { runId }, { jobId: runId });
      expect(await job.getState()).toBe('waiting');
      worker = createProbeWorker(config);
      const result = await job.waitUntilFinished(events, 5000);
      expect(result.runId).toBe(runId);
      expect(await job.getState()).toBe('completed');
    } finally {
      await worker?.close(true);
      await events.close();
      await queue.close();
    }
  }, 15000);

  it('registra payload inválido como falha sem enviar mensagens', async () => {
    const queue = createProbeQueue(config);
    const events = new QueueEvents(PROBE_QUEUE, {
      prefix: config.prefix,
      connection: workerConnection(config),
    });
    let worker: ReturnType<typeof createProbeWorker> | undefined;
    try {
      await queue.waitUntilReady();
      await events.waitUntilReady();
      const job = await queue.add('probe', { runId: 'invalid' });
      const completion = job.waitUntilFinished(events, 5000);
      worker = createProbeWorker(config);
      await expect(completion).rejects.toThrow('Trabalho de teste inválido');
      expect(await job.getState()).toBe('failed');
    } finally {
      await worker?.close(true);
      await events.close();
      await queue.close();
    }
  }, 15000);

  it('prefixos diferentes não compartilham trabalhos', async () => {
    const queue = createProbeQueue(config);
    const other = createProbeQueue({ ...config, prefix: `${config.prefix}-other` });
    try {
      await queue.waitUntilReady();
      await other.waitUntilReady();
      const runId = randomUUID();
      await queue.add('probe', { runId }, { jobId: runId });
      expect(await other.getJob(runId)).toBeUndefined();
    } finally {
      await other.close();
      await queue.close();
    }
  }, 10000);

  it('produtor falha em tempo limitado quando Redis está indisponível', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const queue = createProbeQueue({ ...config, connection: { ...config.connection, port } });
    const started = Date.now();
    try {
      await expect(queue.waitUntilReady()).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(8000);
    } finally {
      await queue.close();
    }
  }, 10000);
});

describe.skipIf(process.env.QUEUE_INTEGRATION !== '1' || !process.env.QUEUE_PERSISTENCE_PHASE)(
  'persistência após restart do Redis',
  () => {
    it('mantém o trabalho aguardando e permite executá-lo após restart', async () => {
      const baseConfig = readQueueConfig();
      const config = { ...baseConfig, prefix: `${baseConfig.prefix}-persist` };
      const queue = createProbeQueue(config);
      const id = process.env.QUEUE_PERSISTENCE_ID!;
      let worker: ReturnType<typeof createProbeWorker> | undefined;
      let events: QueueEvents | undefined;
      try {
        await queue.waitUntilReady();
        if (process.env.QUEUE_PERSISTENCE_PHASE === 'before') {
          const job = await queue.add('probe', { runId: id }, { jobId: id });
          expect(await job.getState()).toBe('waiting');
        } else {
          const job = await queue.getJob(id);
          expect(job).toBeDefined();
          expect(await job!.getState()).toBe('waiting');
          events = new QueueEvents(PROBE_QUEUE, {
            prefix: config.prefix,
            connection: workerConnection(config),
          });
          await events.waitUntilReady();
          worker = createProbeWorker(config);
          expect((await job!.waitUntilFinished(events, 5000)).runId).toBe(id);
        }
      } finally {
        await worker?.close(true);
        await events?.close();
        await queue.close();
      }
    }, 15000);
  },
);
