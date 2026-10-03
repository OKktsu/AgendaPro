import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const backendDirectory = path.join(repositoryRoot, 'backend');
const composeFile = path.join(repositoryRoot, 'docker-compose.multibase-test.yml');
const backendRequire = createRequire(path.join(backendDirectory, 'package.json'));
const prismaCli = backendRequire.resolve('prisma/build/index.js');
const vitestCli = backendRequire.resolve('vitest/vitest.mjs');
const project = `agendapro-multibase-test-${randomUUID().slice(0, 8)}`;

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Não foi possível reservar uma porta local para os testes.'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Não foi possível executar ${command}:`, result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

const port = await findAvailablePort();
const testEnvironment = {
  ...process.env,
  MULTIBASE_PG_HOST: '127.0.0.1',
  MULTIBASE_PG_PORT: String(port),
};
const compose = ['compose', '-p', project, '-f', composeFile];
let exitCode = 0;

try {
  console.log(`Subindo PostgreSQL descartável do projeto ${project} na porta ${port}.`);
  exitCode = run('docker', [...compose, 'up', '-d', '--wait'], { env: testEnvironment });

  if (exitCode === 0) {
    exitCode = run(process.execPath, [path.join(scriptDirectory, 'prepare-multibase.mjs')], {
      env: testEnvironment,
    });
  }

  if (exitCode === 0) {
    const suites = [
      ['src/accounts/multibase.integration.test.ts', { MULTIBASE_INTEGRATION: '1' }],
      ['src/tenant/multibase.integration.test.ts', { MULTIBASE_TENANT_INTEGRATION: '1' }],
    ];
    for (const [suite, flags] of suites) {
      const suiteEnvironment = {
        ...testEnvironment,
        MULTIBASE_INTEGRATION: '0',
        MULTIBASE_TENANT_INTEGRATION: '0',
        ...flags,
      };
      const suiteExitCode = run(process.execPath, [vitestCli, 'run', suite], {
        cwd: backendDirectory,
        env: suiteEnvironment,
      });
      if (suiteExitCode !== 0) exitCode = suiteExitCode;
    }
  }
} finally {
  console.log(`Removendo somente o container temporário ${project} e seus dados de teste.`);
  const cleanupCode = run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], {
    env: testEnvironment,
  });
  if (cleanupCode !== 0 && exitCode === 0) exitCode = cleanupCode;
}

process.exitCode = exitCode;
