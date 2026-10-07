import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { processProbe } from './probe.js';

describe('processador do trabalho de teste', () => {
  it('processa uma referência técnica sem dados pessoais', async () => {
    const runId = randomUUID();
    const result = await processProbe({ name: 'probe', data: { runId } });
    expect(result.runId).toBe(runId);
    expect(new Date(result.processedAt).toISOString()).toBe(result.processedAt);
  });
  it('rejeita tipo de trabalho desconhecido', async () => {
    await expect(
      processProbe({ name: 'send-email', data: { runId: randomUUID() } }),
    ).rejects.toThrow();
  });
  it('rejeita dados inválidos', async () => {
    await expect(processProbe({ name: 'probe', data: { runId: 'bad' } })).rejects.toThrow();
  });
  it('não aceita segredo ou dados pessoais no payload', async () => {
    await expect(
      processProbe({ name: 'probe', data: { runId: randomUUID(), connectionString: 'secret' } }),
    ).rejects.toThrow();
  });
});
