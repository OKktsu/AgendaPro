import type { FastifyReply, FastifyRequest } from 'fastify';

import { type AuthenticatedUser, type TenantContext, verifyJwt } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    tenantContext?: TenantContext;
  }
}

export function getTenantContext(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) {
    throw new Error('Contexto de autenticação/organização não encontrado na requisição.');
  }
  return request.tenantContext;
}

export function createAuthMiddleware(
  jwtSecret = process.env.JWT_SECRET ?? 'agendapro-dev-secret-change-in-production',
) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        message: 'Token de autenticação não fornecido ou inválido.',
      });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return reply.code(401).send({
        message: 'Token de autenticação não fornecido ou inválido.',
      });
    }

    try {
      const user = verifyJwt(token, jwtSecret);
      request.user = user;
      request.tenantContext = {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      };
    } catch {
      return reply.code(401).send({
        message: 'Token de autenticação não fornecido ou inválido.',
      });
    }
  };
}

export function createRequireRoleMiddleware(
  allowedRoles: Array<'OWNER' | 'STAFF'>,
  jwtSecret = process.env.JWT_SECRET ?? 'agendapro-dev-secret-change-in-production',
) {
  const authenticate = createAuthMiddleware(jwtSecret);

  return async function requireRole(request: FastifyRequest, reply: FastifyReply) {
    if (!request.tenantContext) {
      await authenticate(request, reply);
      if (reply.sent) {
        return;
      }
    }

    if (!request.tenantContext || !allowedRoles.includes(request.tenantContext.role)) {
      return reply.code(403).send({
        message: 'Acesso negado. Permissão insuficiente para esta operação.',
      });
    }
  };
}

export function createRequireOwnerMiddleware(
  jwtSecret = process.env.JWT_SECRET ?? 'agendapro-dev-secret-change-in-production',
) {
  return createRequireRoleMiddleware(['OWNER'], jwtSecret);
}

export const requireAuth = createAuthMiddleware;
export const requireOwner = createRequireOwnerMiddleware;
