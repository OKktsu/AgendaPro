import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return value;
}
const project = `agendapro-reminder-test-${randomUUID().slice(0, 8)}`;
const pgPort = await port();
const redisPort = await port();
const env = {
  ...process.env,
  MULTIBASE_PG_HOST: '127.0.0.1',
  MULTIBASE_PG_PORT: String(pgPort),
  QUEUE_TEST_PORT: String(redisPort),
  REDIS_URL: `redis://127.0.0.1:${redisPort}/0`,
  QUEUE_PREFIX: project,
  REMINDER_INTEGRATION: '1',
  REMINDER_TEST_PROJECT: project,
  DATABASE_URL: `postgresql://lab_admin:lab_admin_only@127.0.0.1:${pgPort}/lab_admin`,
};
const compose = [
  'compose',
  '-p',
  project,
  '-f',
  path.join(root, 'docker-compose.multibase-test.yml'),
  '-f',
  path.join(root, 'docker-compose.queue-test.yml'),
];
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error('Falha no laboratório de lembretes:', result.error.code);
  return result.status ?? 1;
}
let code = 0;
try {
  console.log(`Laboratório descartável ${project}: PostgreSQL ${pgPort}, Redis ${redisPort}.`);
  code = run(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '-p',
    'backend/tsconfig.json',
  ]);
  if (!code) code = run('docker', [...compose, 'up', '-d', '--wait']);
  if (!code)
    code = run(process.execPath, [path.join(backend, 'test-support/prepare-multibase.mjs')]);
  if (!code)
    code = run(process.execPath, [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      'backend/prisma/schema.prisma',
    ]);
  // Sequenciais: a segunda suíte usa somente o laboratório e limpa os fixtures da primeira.
  for (const suite of [
    'src/queue/reminders.integration.test.ts',
    'src/queue/background-processes.integration.test.ts',
  ]) {
    if (code) break;
    code = run(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run', suite], backend);
  }
} finally {
  console.log(`Removendo somente ${project} e o volume descartável.`);
  const cleanup = run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
  if (!code) code = cleanup;
}
process.exitCode = code;
