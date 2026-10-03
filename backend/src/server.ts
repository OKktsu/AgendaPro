import 'dotenv/config';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createAccountsRuntime } from './accounts/runtime.js';

const environment = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_MODE: z.enum(['shared', 'dedicated']).default('shared'),
    ACCOUNTS_DATABASE_URL: z.string().optional(),
    TENANT_DATABASE_URLS: z.string().optional(),
  })
  .parse(process.env);

if (
  environment.DATABASE_MODE === 'dedicated' &&
  (!environment.ACCOUNTS_DATABASE_URL ||
    !environment.TENANT_DATABASE_URLS ||
    !process.env.JWT_SECRET)
) {
  throw new Error('Modo dedicado exige Accounts, mapa de bases e JWT_SECRET explícitos.');
}
const runtime =
  environment.DATABASE_MODE === 'dedicated'
    ? createAccountsRuntime(environment.ACCOUNTS_DATABASE_URL!, environment.TENANT_DATABASE_URLS!)
    : undefined;
const app = buildApp(runtime?.dependencies);
if (runtime) app.addHook('onClose', () => runtime.close());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
  });
}

try {
  await app.listen({ port: environment.PORT, host: environment.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
