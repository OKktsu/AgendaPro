import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { DedicatedTenantDatabaseResolver } from './dedicated-database.js';

const tenant = (organizationId: string) => ({
  organizationId,
  userId: 'account',
  role: 'OWNER' as const,
});

function fixture(maxClients = 20) {
  const keys = new Map([
    ['a', 'KEY_A'],
    ['b', 'KEY_B'],
  ]);
  const directory = { findActiveDatabaseKey: vi.fn(async (id: string) => keys.get(id) ?? null) };
  const create = vi.fn(() => ({ $disconnect: vi.fn(async () => {}) }) as unknown as PrismaClient);
  const resolver = new DedicatedTenantDatabaseResolver(
    directory,
    (key) => `postgresql://local/${key}`,
    create,
    maxClients,
  );
  return { resolver, create, keys };
}

describe('DedicatedTenantDatabaseResolver', () => {
  it('seleciona clientes distintos e reutiliza conexões do mesmo tenant', async () => {
    const { resolver, create } = fixture();
    const [a1, a2] = await Promise.all([
      resolver.resolve(tenant('a')),
      resolver.resolve(tenant('a')),
    ]);
    const b = await resolver.resolve(tenant('b'));
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    expect(create).toHaveBeenCalledTimes(2);
    await resolver.close();
    expect(a1.$disconnect).toHaveBeenCalledOnce();
    expect(b.$disconnect).toHaveBeenCalledOnce();
  });

  it('bloqueia tenant desconhecido sem abrir conexão', async () => {
    const { resolver, create } = fixture();
    await expect(resolver.resolve(tenant('unknown'))).rejects.toMatchObject({ statusCode: 503 });
    expect(create).not.toHaveBeenCalled();
  });

  it('revoga acesso quando tenant deixa de estar ativo, mesmo com cliente em cache', async () => {
    const { resolver, keys } = fixture();
    await resolver.resolve(tenant('a'));
    keys.delete('a');
    await expect(resolver.resolve(tenant('a'))).rejects.toThrow('indisponível');
    await resolver.close();
  });

  it('limita clientes sem desconectar conexões usadas por outras requisições', async () => {
    const { resolver } = fixture(1);
    const a = await resolver.resolve(tenant('a'));
    await expect(resolver.resolve(tenant('b'))).rejects.toThrow('indisponível');
    expect(a.$disconnect).not.toHaveBeenCalled();
    await resolver.close();
  });

  it('não aceita requisições depois do encerramento', async () => {
    const { resolver, create } = fixture();
    await resolver.close();
    await expect(resolver.resolve(tenant('a'))).rejects.toThrow('indisponível');
    expect(create).not.toHaveBeenCalled();
  });

  it('não abre conexão quando a referência do segredo está ausente', async () => {
    const create = vi.fn();
    const resolver = new DedicatedTenantDatabaseResolver(
      { findActiveDatabaseKey: async () => 'missing' },
      () => undefined,
      create,
    );
    await expect(resolver.resolve(tenant('a'))).rejects.toThrow('indisponível');
    expect(create).not.toHaveBeenCalled();
  });
});
