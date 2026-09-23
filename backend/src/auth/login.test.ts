import { describe, expect, it, vi } from 'vitest';

import {
  InvalidCredentialsError,
  loginBodySchema,
  loginUser,
  type LoginUserDatabase,
} from './login.js';
import { InvalidTokenError, signJwt, verifyJwt, type AuthenticatedUser } from './jwt.js';
import { hashPassword, verifyPassword } from './register.js';

describe('validação de login', () => {
  const validInput = {
    email: 'marcelo@example.com',
    password: 'senha-segura-123',
  };

  it('aceita dados válidos de login', () => {
    expect(loginBodySchema.safeParse(validInput).success).toBe(true);
  });

  it('rejeita formato de e-mail inválido', () => {
    expect(loginBodySchema.safeParse({ ...validInput, email: 'invalido' }).success).toBe(false);
  });

  it('rejeita senha vazia', () => {
    expect(loginBodySchema.safeParse({ ...validInput, password: '' }).success).toBe(false);
  });
});

describe('verificação de hash de senha (scrypt)', () => {
  const password = 'minha-senha-secreta';

  it('retorna true para a senha correta', async () => {
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);

    expect(isValid).toBe(true);
  });

  it('retorna false para senha incorreta', async () => {
    const hash = await hashPassword(password);
    const isValid = await verifyPassword('senha-errada', hash);

    expect(isValid).toBe(false);
  });

  it('retorna false para hash com formato inválido', async () => {
    expect(await verifyPassword(password, 'formato-invalido')).toBe(false);
    expect(await verifyPassword(password, 'bcrypt$abc$def')).toBe(false);
    expect(await verifyPassword(password, 'scrypt$incompleto')).toBe(false);
  });
});

describe('geração e validação de JWT', () => {
  const secret = 'segredo-de-teste-12345';
  const testUser: AuthenticatedUser = {
    id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
    name: 'Marcelo Luan',
    email: 'marcelo@example.com',
    role: 'OWNER',
    organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
  };

  it('gera token válido e decodifica usuário autenticado com sucesso', () => {
    const token = signJwt(testUser, secret);
    const decoded = verifyJwt(token, secret);

    expect(decoded).toEqual(testUser);
    expect(decoded).not.toHaveProperty('passwordHash');
    expect(decoded).not.toHaveProperty('password');
  });

  it('rejeita token com assinatura adulterada ou segredo incorreto', () => {
    const token = signJwt(testUser, secret);

    expect(() => verifyJwt(token, 'outro-segredo-diferente')).toThrow(InvalidTokenError);
  });

  it('rejeita formato de token malformado', () => {
    expect(() => verifyJwt('token-invalido', secret)).toThrow(InvalidTokenError);
    expect(() => verifyJwt('a.b', secret)).toThrow(InvalidTokenError);
  });

  it('rejeita token expirado', () => {
    const expiredToken = signJwt(testUser, secret, -10);

    expect(() => verifyJwt(expiredToken, secret)).toThrow('Token expirado.');
  });
});

describe('serviço loginUser', () => {
  const secret = 'segredo-de-teste-12345';
  const password = 'senha-segura-123';

  it('autentica com sucesso e retorna JWT e dados seguros do usuário', async () => {
    const passwordHash = await hashPassword(password);
    const mockUser = {
      id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
      name: 'Marcelo Luan',
      email: 'marcelo@example.com',
      passwordHash,
      role: 'OWNER' as const,
      organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
    };

    const mockDb: LoginUserDatabase = {
      user: {
        findUnique: vi.fn().mockResolvedValue(mockUser),
      },
    };

    const result = await loginUser({ email: 'MARCELO@example.com', password }, secret, mockDb);

    expect(result.token).toBeTypeOf('string');
    expect(result.user).toEqual({
      id: mockUser.id,
      name: mockUser.name,
      email: mockUser.email,
      role: 'OWNER',
      organizationId: mockUser.organizationId,
    });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('password');

    const decoded = verifyJwt(result.token, secret);
    expect(decoded.id).toBe(mockUser.id);
    expect(decoded).not.toHaveProperty('passwordHash');
  });

  it('lança InvalidCredentialsError quando o usuário não existe', async () => {
    const mockDb: LoginUserDatabase = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      loginUser({ email: 'inexistente@example.com', password }, secret, mockDb),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('lança InvalidCredentialsError quando a senha está incorreta', async () => {
    const passwordHash = await hashPassword(password);
    const mockDb: LoginUserDatabase = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-id',
          name: 'Nome',
          email: 'teste@example.com',
          passwordHash,
          role: 'OWNER',
          organizationId: 'org-id',
        }),
      },
    };

    await expect(
      loginUser({ email: 'teste@example.com', password: 'senha-errada' }, secret, mockDb),
    ).rejects.toThrow(InvalidCredentialsError);
  });
});
