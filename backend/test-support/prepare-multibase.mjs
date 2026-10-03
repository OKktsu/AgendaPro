import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const prisma = require.resolve('prisma/build/index.js');
const host = process.env.MULTIBASE_PG_HOST ?? '127.0.0.1';
const port = Number(process.env.MULTIBASE_PG_PORT ?? 55433);
const databases = [
  ['accounts', 'ACCOUNTS_DATABASE_URL', 'accounts_lab', 'accounts_lab_only'],
  ['tenant', 'TENANT_DATABASE_URL', 'tenant_a_lab', 'tenant_a_lab_only'],
  ['tenant', 'TENANT_DATABASE_URL', 'tenant_b_lab', 'tenant_b_lab_only'],
];
for (const [schema, variable, db, password] of databases) {
  const result = spawnSync(
    process.execPath,
    [prisma, 'migrate', 'deploy', '--schema', `backend/prisma/${schema}/schema.prisma`],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        [variable]: `postgresql://${db}:${password}@${host}:${port}/${db}`,
      },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
