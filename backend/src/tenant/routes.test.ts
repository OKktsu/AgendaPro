import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { signJwt } from '../auth/jwt.js';
import { TenantDatabaseUnavailableError } from './dedicated-database.js';

describe('fronteira HTTP de seleção do banco', () => {
  const secret = 'test-only';
  const user = {
    id: 'account-a',
    organizationId: 'tenant-a',
    role: 'OWNER' as const,
    name: 'A',
    email: 'a@example.test',
  };

  it('não resolve banco para requisição sem autenticação', async () => {
    const resolve = vi.fn();
    const app = buildApp({ jwtSecret: secret, tenantDatabaseResolver: { resolve } });
    try {
      const response = await app.inject({ method: 'GET', url: '/customers' });
      expect(response.statusCode).toBe(401);
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['/customers', '/services', '/professionals', '/appointments'])(
    'resolve %s somente com identidade do token e falha sem fallback',
    async (url) => {
      const resolve = vi.fn(async () => {
        throw new TenantDatabaseUnavailableError();
      });
      const app = buildApp({ jwtSecret: secret, tenantDatabaseResolver: { resolve } });
      try {
        const response = await app.inject({
          method: 'GET',
          url: `${url}?organizationId=tenant-b`,
          headers: { authorization: `Bearer ${signJwt(user, secret)}` },
        });
        expect(response.statusCode).toBe(503);
        expect(resolve).toHaveBeenCalledExactlyOnceWith({
          userId: user.id,
          organizationId: user.organizationId,
          role: 'OWNER',
        });
      } finally {
        await app.close();
      }
    },
  );
});
