import 'dotenv/config';
import { readQueueConfig } from './queue/config.js';
import { createProbeWorker } from './queue/probe.js';

const worker = createProbeWorker(readQueueConfig());
console.log(
  'Worker iniciado: aguardando Redis e trabalhos de teste. Não envia mensagens externas.',
);
worker.on('ready', () => console.log('Worker conectado ao Redis.'));
worker.on('completed', (job) => console.log(`Trabalho ${job.id} concluído.`));
worker.on('failed', (job) => console.error(`Trabalho ${job?.id ?? 'desconhecido'} falhou.`));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('Encerrando worker e conexões.');
  const deadline = setTimeout(() => {
    console.error(
      'Encerramento excedeu 10 segundos; trabalhos interrompidos poderão ser recuperados pela fila.',
    );
    process.exit(1);
  }, 10000);
  try {
    await worker.close();
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
