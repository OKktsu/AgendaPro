import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { retryTransaction } from './retry-transaction.js';

describe('retryTransaction', () => {
  const deadlock = () =>
    new Prisma.PrismaClientUnknownRequestError('PostgresError code: "40P01"', {
      clientVersion: 'test',
    });
  it('repete uma transação abortada e retorna o resultado confirmado', async () => {
    const run = vi.fn().mockRejectedValueOnce(deadlock()).mockResolvedValue('confirmed');
    expect(await retryTransaction(run)).toBe('confirmed');
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('encerra depois de três tentativas', async () => {
    const run = vi.fn().mockRejectedValue(deadlock());
    await expect(retryTransaction(run)).rejects.toThrow('40P01');
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('não repete erro de rede nem erro desconhecido', async () => {
    const run = vi.fn().mockRejectedValue(new Error('network timeout'));
    await expect(retryTransaction(run)).rejects.toThrow('network timeout');
    expect(run).toHaveBeenCalledOnce();
  });
});
