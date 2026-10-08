import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBackgroundShutdown } from './background-shutdown.js';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
function setup(close = vi.fn().mockResolvedValue(undefined)) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  const error = vi.fn();
  const stop = installBackgroundShutdown('teste', close, {
    signals,
    exit,
    error,
    log: vi.fn(),
    timeoutMs: 1000,
  });
  return { signals, exit, error, stop, close };
}
describe('encerramento dos processos de background', () => {
  it.each(['SIGINT', 'SIGTERM'])('encerra recursos pelo sinal %s', async (signal) => {
    const { signals, close, exit, stop } = setup();
    signals.emit(signal);
    await stop();
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(signals.listenerCount('message')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
  it('sinais repetidos encerram os recursos somente uma vez', async () => {
    const { signals, stop, close, exit } = setup();
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await Promise.all([stop(), stop()]);
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
  it('IPC do processo pai aceita apenas mensagem explícita de shutdown', async () => {
    const { signals, stop, close } = setup();
    for (const message of [null, 'shutdown', { type: 'other' }]) signals.emit('message', message);
    expect(close).not.toHaveBeenCalled();
    signals.emit('message', { type: 'shutdown' });
    await stop();
    expect(close).toHaveBeenCalledOnce();
  });
  it('não sai antes dos recursos terminarem de fechar', async () => {
    let finish!: () => void;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { stop, exit } = setup(close);
    const closing = stop();
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('falha de fechamento sai com erro sem expor a mensagem original', async () => {
    const { stop, exit, error } = setup(vi.fn().mockRejectedValue(new Error('secret://password')));
    await stop();
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith('Falha ao encerrar teste.');
  });
  it('limite de tempo encerra uma única vez com erro', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const { stop, exit } = setup(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const closing = stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    finish();
    await closing;
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
