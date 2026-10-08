import 'dotenv/config';
import { readQueueConfig } from './queue/config.js';
import { createProbeWorker } from './queue/probe.js';
import { installBackgroundShutdown } from './queue/background-shutdown.js';

const worker = createProbeWorker(readQueueConfig());
console.log(
  'Worker probe iniciado: apenas demonstração Redis, sem banco de empresas ou mensagens externas.',
);
worker.on('ready', () => {
  console.log('Worker probe conectado ao Redis.');
  process.send?.({ type: 'ready', role: 'probe' });
});
worker.on('completed', (job) => console.log(`Trabalho ${job.id} concluído.`));
worker.on('failed', (job) => console.error(`Trabalho ${job?.id ?? 'desconhecido'} falhou.`));
installBackgroundShutdown('worker probe', () => worker.close());
