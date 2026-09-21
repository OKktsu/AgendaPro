import cors from '@fastify/cors';
import Fastify from 'fastify';

import {
  EmailAlreadyRegisteredError,
  registerBodySchema,
  registerOrganizationOwner,
} from './auth/register.js';

type AppDependencies = {
  registerOrganizationOwner?: typeof registerOrganizationOwner;
};

export function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({ logger: true });
  const registerOwner =
    dependencies.registerOrganizationOwner ?? registerOrganizationOwner;

  app.register(cors, { origin: true });

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.post('/auth/register', async (request, reply) => {
    const parsedBody = registerBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        message: 'Dados de cadastro inválidos.',
        issues: parsedBody.error.flatten().fieldErrors,
      });
    }

    try {
      const registration = await registerOwner(parsedBody.data);

      return reply.code(201).send(registration);
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        return reply.code(409).send({ message: error.message });
      }

      throw error;
    }
  });

  return app;
}
