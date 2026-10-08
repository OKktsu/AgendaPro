import 'dotenv/config';
import { readQueueConfig } from './queue/config.js';
import { createReminderDatabases } from './queue/reminder-databases.js';
import { createReminderWorker } from './queue/reminders.js';
import { installBackgroundShutdown } from './queue/background-shutdown.js';

const config = readQueueConfig();
const databases = createReminderDatabases();
const worker = createReminderWorker(config, databases);
console.log(
  'Worker de lembretes iniciado: somente consumo; envio simulado, sem polling do outbox.',
);
worker.on('ready', () => {
  console.log('Worker de lembretes conectado ao Redis.');
  process.send?.({ type: 'ready', role: 'consumer' });
});
worker.on('completed', (job, result) =>
  console.log(`Lembrete ${job.id}: ${result} (simulação, sem envio externo).`),
);
worker.on('failed', (job) =>
  console.error(`Lembrete ${job?.id ?? 'desconhecido'} falhou; confira o histórico da fila.`),
);
installBackgroundShutdown('worker de lembretes', async () => {
  // Não fechar a base enquanto o worker ainda estiver concluindo um trabalho ativo.
  await worker.close();
  await databases.close();
});
