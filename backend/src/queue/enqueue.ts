import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readQueueConfig } from './config.js';
import { createProbeQueue } from './probe.js';

async function main() {
  const queue = createProbeQueue(readQueueConfig());
  try {
    await queue.waitUntilReady();
    const runId = randomUUID();
    const job = await queue.add('probe', { runId }, { jobId: runId });
    console.log(`Trabalho ${job.id} aceito na fila. O worker pode estar parado.`);
  } finally {
    await queue.close();
  }
}
main().catch(() => {
  console.error('Não foi possível confirmar o envio à fila. Confira o Redis e a configuração.');
  process.exitCode = 1;
});
