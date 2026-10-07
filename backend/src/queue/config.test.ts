import { describe, expect, it } from 'vitest';
import { readQueueConfig, producerConnection, workerConnection } from './config.js';

describe('configuração de filas', () => {
  it('usa namespace local e conexão de loopback por padrão', () => {
    expect(readQueueConfig({})).toMatchObject({
      prefix: 'agendapro-local',
      concurrency: 1,
      connection: { host: '127.0.0.1', port: 6379, db: 0 },
    });
  });
  it('interpreta TLS e credenciais sem imprimi-las', () => {
    expect(
      readQueueConfig({ REDIS_URL: 'rediss://user:pass%40word@redis.example:6380/2' }).connection,
    ).toMatchObject({
      host: 'redis.example',
      port: 6380,
      db: 2,
      username: 'user',
      password: 'pass@word',
      tls: {},
    });
  });
  it.each([
    'http://localhost',
    'redis://localhost/nope',
    'redis://localhost/16',
    'redis://localhost/1?secret=bad',
  ])('rejeita URL incompatível: %s', (url) => {
    expect(() => readQueueConfig({ REDIS_URL: url })).toThrow('Configuração de fila inválida');
  });
  it('não vaza segredo em erro de configuração', () => {
    try {
      readQueueConfig({ REDIS_URL: 'http://user:private-password@localhost' });
    } catch (err) {
      expect(String(err)).not.toContain('private-password');
      return;
    }
    throw new Error('Esperava erro de configuração');
  });
  it('limita concorrência e rejeita prefixo inválido', () => {
    expect(() => readQueueConfig({ WORKER_CONCURRENCY: '0' })).toThrow();
    expect(() => readQueueConfig({ WORKER_CONCURRENCY: '11' })).toThrow();
    expect(() => readQueueConfig({ QUEUE_PREFIX: 'bad:prefix' })).toThrow();
  });
  it('produtor tem espera limitada e worker aguarda reconexão', () => {
    const config = readQueueConfig({});
    const producer = producerConnection(config);
    const worker = workerConnection(config);
    expect(producer).toMatchObject({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 5000,
    });
    expect(producer.retryStrategy?.(1)).toBeNull();
    expect(worker).toMatchObject({ maxRetriesPerRequest: null, enableOfflineQueue: true });
    expect(worker.commandTimeout).toBeUndefined();
    expect(worker.retryStrategy?.(100)).toBe(5000);
  });
});
