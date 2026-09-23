import type { FastifyReply, FastifyRequest } from 'fastify';

import { type AuthenticatedUser, verifyJwt } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
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
    } catch {
      return reply.code(401).send({
        message: 'Token de autenticação não fornecido ou inválido.',
      });
    }
  };
}
