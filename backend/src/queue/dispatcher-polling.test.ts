import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDispatcherInterval, startDispatcherPolling } from './dispatcher-polling.js';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('intervalo exclusivo do dispatcher', () => {
  it('usa 5s por padrão e aceita intervalo configurado', () => {
    expect(readDispatcherInterval({})).toBe(5000);
    expect(readDispatcherInterval({ REMINDER_POLL_INTERVAL_MS: '1000' })).toBe(1000);
  });
  it.each(['0', '-1', '60001', 'invalid', '1000.5'])('rejeita intervalo inválido: %s', (value) => {
    expect(() => readDispatcherInterval({ REMINDER_POLL_INTERVAL_MS: value })).toThrow(
      'REMINDER_POLL_INTERVAL_MS',
    );
  });
});
describe('polling independente', () => {
  it('consulta ao iniciar e repete no intervalo', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const polling = startDispatcherPolling(dispatch, 1000, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatch).toHaveBeenCalledTimes(2);
    await polling.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('não sobrepõe consultas quando um ciclo demora', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const dispatch = vi.fn().mockReturnValue(pending);
    const polling = startDispatcherPolling(dispatch, 1000, vi.fn());
    await vi.advanceTimersByTimeAsync(3500);
    expect(dispatch).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatch).toHaveBeenCalledTimes(2);
    await polling.close();
  });
  it('uma falha não impede o próximo ciclo', async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(undefined);
    const polling = startDispatcherPolling(dispatch, 1000, error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(2);
    await polling.close();
  });
  it('encerramento sinaliza parada e aguarda o ciclo ativo sem iniciar outro', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    let shouldStop!: () => boolean;
    const polling = startDispatcherPolling(
      (stop) => {
        shouldStop = stop;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      1000,
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(0);
    let closed = false;
    const closing = polling.close().then(() => {
      closed = true;
    });
    expect(shouldStop()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(closed).toBe(false);
    finish();
    await closing;
    expect(closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
