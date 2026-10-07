import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
const vitest = require.resolve('vitest/vitest.mjs');
const id = randomUUID();
const project = `agendapro-queue-test-${id.slice(0, 8)}`;
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
);
const env = {
  ...process.env,
  QUEUE_TEST_PORT: String(port),
  REDIS_URL: `redis://127.0.0.1:${port}/0`,
  QUEUE_PREFIX: `queue-test-${id.slice(0, 8)}`,
  QUEUE_INTEGRATION: '1',
  QUEUE_PERSISTENCE_ID: id,
};
const compose = ['compose', '-p', project, '-f', path.join(root, 'docker-compose.queue-test.yml')];
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: extra.cwd ?? root,
    env: { ...env, ...extra.env },
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.error) console.error('Falha ao executar laboratório:', result.error.code);
  return result.status ?? 1;
}
let exitCode = 0;
try {
  console.log(`Redis descartável ${project} na porta ${port}.`);
  exitCode = run('docker', [...compose, 'up', '-d', '--wait']);
  for (const phase of ['before', 'after']) {
    if (exitCode) break;
    if (phase === 'after') {
      exitCode = run('docker', [...compose, 'stop', 'redis-test']);
      if (!exitCode) exitCode = run('docker', [...compose, 'up', '-d', '--wait']);
      if (exitCode) break;
    }
    exitCode = run(process.execPath, [vitest, 'run', 'src/queue/queue.integration.test.ts'], {
      cwd: backend,
      env: { QUEUE_PERSISTENCE_PHASE: phase },
    });
  }
} finally {
  console.log(`Removendo somente o laboratório ${project} e seu volume de testes.`);
  const cleanup = run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
  if (!exitCode) exitCode = cleanup;
}
process.exitCode = exitCode;
