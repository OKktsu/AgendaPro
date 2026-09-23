import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { signJwt } from './jwt.js';
import {
  createAuthMiddleware,
  createRequireOwnerMiddleware,
  getTenantContext,
} from './middleware.js';

describe('auth middleware and helpers', () => {
  const jwtSecret = 'teste-secret-middleware';

  const staffUser = {
    id: 'user-staff-1',
    name: 'Staff João',
    email: 'staff@example.com',
    role: 'STAFF' as const,
    organizationId: 'org-1',
  };

  const ownerUser = {
    id: 'user-owner-1',
    name: 'Owner Maria',
    email: 'owner@example.com',
    role: 'OWNER' as const,
    organizationId: 'org-1',
  };

  describe('getTenantContext', () => {
    it('returns tenantContext when present on request', () => {
      const mockRequest = {
        tenantContext: {
          userId: 'user-1',
          organizationId: 'org-1',
          role: 'OWNER' as const,
        },
      } as unknown as FastifyRequest;

      const context = getTenantContext(mockRequest);
      expect(context).toEqual({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'OWNER',
      });
    });

    it('throws error when tenantContext is absent', () => {
      const mockRequest = {} as FastifyRequest;

      expect(() => getTenantContext(mockRequest)).toThrow(
        'Contexto de autenticação/organização não encontrado na requisição.',
      );
    });
  });

  describe('createAuthMiddleware', () => {
    it('sets request.user and request.tenantContext from valid JWT', async () => {
      const authenticate = createAuthMiddleware(jwtSecret);
      const token = signJwt(staffUser, jwtSecret);

      const request = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as FastifyRequest;
      const reply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply;

      await authenticate(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(request.user).toEqual(staffUser);
      expect(request.tenantContext).toEqual({
        userId: staffUser.id,
        organizationId: staffUser.organizationId,
        role: 'STAFF',
      });
    });
  });

  describe('createRequireRoleMiddleware / createRequireOwnerMiddleware', () => {
    it('allows OWNER user to proceed', async () => {
      const requireOwner = createRequireOwnerMiddleware(jwtSecret);
      const token = signJwt(ownerUser, jwtSecret);

      const request = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as FastifyRequest;
      const reply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply;

      await requireOwner(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(request.tenantContext?.role).toBe('OWNER');
    });

    it('rejects STAFF user with 403', async () => {
      const requireOwner = createRequireOwnerMiddleware(jwtSecret);
      const token = signJwt(staffUser, jwtSecret);

      const request = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as FastifyRequest;
      const reply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply;

      await requireOwner(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });
});
