import cors from '@fastify/cors';
import Fastify from 'fastify';

import {
  EmailAlreadyRegisteredError,
  registerBodySchema,
  registerOrganizationOwner,
} from './auth/register.js';
import { InvalidCredentialsError, loginBodySchema, loginUser } from './auth/login.js';
import {
  createAuthMiddleware,
  createRequireOwnerMiddleware,
  getTenantContext,
} from './auth/middleware.js';
import {
  assignProfessionalToService,
  assignServiceParamsSchema,
  createProfessional,
  createProfessionalSchema,
  createService,
  createServiceSchema,
  listProfessionals,
  listServices,
  NotFoundError,
  type CatalogDatabase,
} from './catalog/catalog.js';

type AppDependencies = {
  registerOrganizationOwner?: typeof registerOrganizationOwner;
  loginUser?: typeof loginUser;
  jwtSecret?: string;
  catalogDatabase?: CatalogDatabase;
  createService?: typeof createService;
  listServices?: typeof listServices;
  createProfessional?: typeof createProfessional;
  listProfessionals?: typeof listProfessionals;
  assignProfessionalToService?: typeof assignProfessionalToService;
};

export function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({ logger: true });
  const registerOwner = dependencies.registerOrganizationOwner ?? registerOrganizationOwner;
  const login = dependencies.loginUser ?? loginUser;
  const jwtSecret =
    dependencies.jwtSecret ?? process.env.JWT_SECRET ?? 'agendapro-dev-secret-change-in-production';
  const authenticate = createAuthMiddleware(jwtSecret);
  const requireAuth = authenticate;
  const requireOwner = createRequireOwnerMiddleware(jwtSecret);

  const catalogDb = dependencies.catalogDatabase;
  const svcCreateService = dependencies.createService ?? createService;
  const svcListServices = dependencies.listServices ?? listServices;
  const svcCreateProfessional = dependencies.createProfessional ?? createProfessional;
  const svcListProfessionals = dependencies.listProfessionals ?? listProfessionals;
  const svcAssignProfessional =
    dependencies.assignProfessionalToService ?? assignProfessionalToService;

  app.register(cors, { origin: true });

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.post('/auth/login', async (request, reply) => {
    const parsedBody = loginBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        message: 'Dados de login inválidos.',
        issues: parsedBody.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await login(parsedBody.data, jwtSecret);

      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return reply.code(401).send({ message: error.message });
      }

      throw error;
    }
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send({ user: request.user });
  });

  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const tenantContext = getTenantContext(request);

    return reply.code(200).send({
      userId: tenantContext.userId,
      organizationId: tenantContext.organizationId,
      role: tenantContext.role,
      user: request.user,
      organization: {
        id: tenantContext.organizationId,
      },
    });
  });

  app.get('/owner-area', { preHandler: requireOwner }, async (request, reply) => {
    const tenantContext = getTenantContext(request);

    return reply.code(200).send({
      message: 'Acesso permitido à área do proprietário.',
      tenantContext,
      role: tenantContext.role,
      organizationId: tenantContext.organizationId,
    });
  });

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

  app.post('/services', { preHandler: requireOwner }, async (request, reply) => {
    const parsedBody = createServiceSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        message: 'Dados de serviço inválidos.',
        issues: parsedBody.error.flatten().fieldErrors,
      });
    }

    const tenantContext = getTenantContext(request);
    const service = await svcCreateService(
      parsedBody.data,
      tenantContext.organizationId,
      catalogDb,
    );

    return reply.code(201).send({ service, ...service });
  });

  app.get('/services', { preHandler: requireAuth }, async (request, reply) => {
    const tenantContext = getTenantContext(request);
    const services = await svcListServices(tenantContext.organizationId, catalogDb);

    return reply.code(200).send({ services });
  });

  app.post('/professionals', { preHandler: requireOwner }, async (request, reply) => {
    const parsedBody = createProfessionalSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        message: 'Dados de profissional inválidos.',
        issues: parsedBody.error.flatten().fieldErrors,
      });
    }

    const tenantContext = getTenantContext(request);
    const professional = await svcCreateProfessional(
      parsedBody.data,
      tenantContext.organizationId,
      catalogDb,
    );

    return reply.code(201).send({ professional, ...professional });
  });

  app.get('/professionals', { preHandler: requireAuth }, async (request, reply) => {
    const tenantContext = getTenantContext(request);
    const professionals = await svcListProfessionals(tenantContext.organizationId, catalogDb);

    return reply.code(200).send({ professionals });
  });

  app.post(
    '/professionals/:professionalId/services/:serviceId',
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsedParams = assignServiceParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({
          message: 'Parâmetros de rota inválidos.',
          issues: parsedParams.error.flatten().fieldErrors,
        });
      }

      const tenantContext = getTenantContext(request);

      try {
        const result = await svcAssignProfessional(
          parsedParams.data.professionalId,
          parsedParams.data.serviceId,
          tenantContext.organizationId,
          catalogDb,
        );

        return reply.code(201).send({
          message: 'Profissional vinculado ao serviço com sucesso.',
          professionalId: result.professionalService.professionalId,
          serviceId: result.professionalService.serviceId,
          professionalService: result.professionalService,
        });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ message: error.message });
        }

        throw error;
      }
    },
  );

  return app;
}
