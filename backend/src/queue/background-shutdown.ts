import type { EventEmitter } from 'node:events';

/** SIGINT/SIGTERM e IPC de um processo pai: sem endpoint de shutdown exposto. */
export function installBackgroundShutdown(
  role: string,
  close: () => Promise<void>,
  options: {
    signals?: EventEmitter;
    exit?: (code: number) => void;
    timeoutMs?: number;
    log?: (message: string) => void;
    error?: (message: string) => void;
  } = {},
) {
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  let stopping: Promise<void> | undefined;
  let timedOut = false;
  const onSignal = () => {
    void stop();
  };
  const onMessage = (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown')
      void stop();
  };
  function stop(): Promise<void> {
    if (stopping) return stopping;
    log(`Encerrando ${role} e conexões.`);
    const deadline = setTimeout(() => {
      timedOut = true;
      cleanup();
      error(
        `Encerramento de ${role} excedeu o limite; trabalhos pendentes poderão ser recuperados.`,
      );
      exit(1);
    }, options.timeoutMs ?? 10000);
    stopping = Promise.resolve()
      .then(close)
      .then(
        () => {
          cleanup();
          if (!timedOut) exit(0);
        },
        () => {
          cleanup();
          if (!timedOut) {
            error(`Falha ao encerrar ${role}.`);
            exit(1);
          }
        },
      );
    function cleanup() {
      clearTimeout(deadline);
      signals.off('SIGINT', onSignal);
      signals.off('SIGTERM', onSignal);
      signals.off('message', onMessage);
    }
    return stopping;
  }
  signals.once('SIGINT', onSignal);
  signals.once('SIGTERM', onSignal);
  signals.on('message', onMessage);
  return stop;
}
