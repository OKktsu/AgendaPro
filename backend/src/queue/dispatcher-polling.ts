import { z } from 'zod';

export function readDispatcherInterval(env: Record<string, string | undefined> = process.env) {
  try {
    return z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .parse(env.REMINDER_POLL_INTERVAL_MS ?? '5000');
  } catch {
    throw new Error('REMINDER_POLL_INTERVAL_MS deve ser um inteiro entre 1000 e 60000.');
  }
}

/** Apenas agendamento de consultas: não cria consumidor BullMQ nem conexão de banco. */
export function startDispatcherPolling(
  dispatch: (shouldStop: () => boolean) => Promise<void>,
  intervalMs: number,
  onError: () => void,
) {
  let closing = false;
  let active: Promise<void> | undefined;
  function tick() {
    if (closing || active) return;
    active = Promise.resolve()
      .then(() => dispatch(() => closing))
      .catch(onError)
      .finally(() => {
        active = undefined;
      });
  }
  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    async close() {
      closing = true;
      clearInterval(timer);
      await active;
    },
  };
}
