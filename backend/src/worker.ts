import 'dotenv/config';
import { readQueueConfig } from './queue/config.js';
import { createProbeWorker } from './queue/probe.js';
import { z } from 'zod';
import { createReminderDatabases } from './queue/reminder-databases.js';
import { createReminderQueue, createReminderWorker, dispatchReminders } from './queue/reminders.js';

const worker = createProbeWorker(readQueueConfig());
const databases = createReminderDatabases();
const reminderQueue = createReminderQueue(readQueueConfig());
const reminderWorker = createReminderWorker(readQueueConfig(), databases);
const pollInterval = z.coerce
  .number()
  .int()
  .min(1000)
  .max(60000)
  .parse(process.env.REMINDER_POLL_INTERVAL_MS ?? '5000');
console.log(
  'Worker iniciado: aguardando Redis, trabalhos de teste e lembretes simulados. Não envia mensagens externas.',
);
worker.on('ready', () => console.log('Worker conectado ao Redis.'));
reminderWorker.on('ready', () => console.log('Worker de lembretes conectado ao Redis.'));
worker.on('completed', (job) => console.log(`Trabalho ${job.id} concluído.`));
worker.on('failed', (job) => console.error(`Trabalho ${job?.id ?? 'desconhecido'} falhou.`));
reminderWorker.on('completed', (job, result) =>
  console.log(`Lembrete ${job.id}: ${result} (simulação, sem envio externo).`),
);
reminderWorker.on('failed', (job) =>
  console.error(`Lembrete ${job?.id ?? 'desconhecido'} falhou; confira o histórico da fila.`),
);
let closing = false;
let activePoll: Promise<void> | undefined;
function poll() {
  if (closing || activePoll) return;
  activePoll = dispatchReminders(databases, reminderQueue)
    .catch(() =>
      console.error(
        'Lembretes: diretório indisponível ou limite de organizações; confira as bases e migrations.',
      ),
    )
    .finally(() => {
      activePoll = undefined;
    });
}
const timer = setInterval(poll, pollInterval);
poll();
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  console.log('Encerrando worker e conexões.');
  const deadline = setTimeout(() => {
    console.error(
      'Encerramento excedeu 10 segundos; trabalhos interrompidos poderão ser recuperados pela fila.',
    );
    process.exit(1);
  }, 10000);
  try {
    await Promise.all([worker.close(), reminderWorker.close()]);
    await activePoll;
    await reminderQueue.close();
    await databases.close();
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    clearTimeout(deadline);
    console.error('Falha ao encerrar worker.');
    process.exit(1);
  }
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
