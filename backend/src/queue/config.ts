import { RedisConnection, createIORedisClient, type RedisOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

// Resolver o driver pelo workspace backend, sem depender do hoisting do npm.
// A conexão criada pela factory pertence ao BullMQ, que a encerra ao fechar a fila.
RedisConnection.clientFactory = (options) => createIORedisClient(new Redis(options));

export type QueueConfig = { connection: RedisOptions; prefix: string; concurrency: number };

export function readQueueConfig(
  env: Record<string, string | undefined> = process.env,
): QueueConfig {
  try {
    const url = new URL(env.REDIS_URL ?? 'redis://127.0.0.1:6379/0');
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.search || url.hash)
      throw new Error();
    const database =
      url.pathname === '' || url.pathname === '/' ? 0 : Number(url.pathname.slice(1));
    if (
      !/^\/(\d+)?$/.test(url.pathname || '/') ||
      !Number.isInteger(database) ||
      database < 0 ||
      database > 15
    )
      throw new Error();
    const port = z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(url.port || '6379');
    return {
      connection: {
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port,
        db: database,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
        connectTimeout: 2000,
      },
      prefix: z
        .string()
        .regex(/^[a-z][a-z0-9_-]{0,63}$/)
        .parse(env.QUEUE_PREFIX ?? 'agendapro-local'),
      concurrency: z.coerce
        .number()
        .int()
        .min(1)
        .max(10)
        .parse(env.WORKER_CONCURRENCY ?? '1'),
    };
  } catch {
    // Nunca incluir REDIS_URL (que pode conter senha) em mensagens de erro.
    throw new Error(
      'Configuração de fila inválida. Confira REDIS_URL, QUEUE_PREFIX e WORKER_CONCURRENCY.',
    );
  }
}

export function producerConnection(config: QueueConfig): RedisOptions {
  return {
    ...config.connection,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    commandTimeout: 5000,
  };
}
export function workerConnection(config: QueueConfig): RedisOptions {
  return {
    ...config.connection,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  };
}
