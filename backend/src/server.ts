import 'dotenv/config';
import { z } from 'zod';
import { buildApp } from './app.js';

const environment = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
  })
  .parse(process.env);

const app = buildApp();

try {
  await app.listen({ port: environment.PORT, host: environment.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

