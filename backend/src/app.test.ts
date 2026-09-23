import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailAlreadyRegisteredError } from './auth/register.js';
import { InvalidCredentialsError } from './auth/login.js';
import { signJwt } from './auth/jwt.js';
import { buildApp } from './app.js';

describe('GET /health', () => {
  const app = buildApp();

  afterEach(async () => {
    await app.close();
  });

  it('reports the API as healthy', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('POST /auth/register', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  it('creates an organization and its owner', async () => {
    const registerOrganizationOwner = vi.fn().mockResolvedValue({
      organization: { id: '4e0d9057-4648-44a2-8489-3c22098d3a93', name: 'Barbearia Central' },
      user: {
        id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
        name: 'Marcelo Luan',
        email: 'marcelo@example.com',
        role: 'OWNER',
        organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
      },
    });
    const app = buildApp({ registerOrganizationOwner });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        organizationName: 'Barbearia Central',
        name: 'Marcelo Luan',
        email: 'marcelo@example.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      organization: { name: 'Barbearia Central' },
      user: { role: 'OWNER' },
    });
    expect(registerOrganizationOwner).toHaveBeenCalledOnce();
  });

  it('rejects invalid registration data', async () => {
    const registerOrganizationOwner = vi.fn();
    const app = buildApp({ registerOrganizationOwner });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { organizationName: 'A', name: 'B', email: 'invalido', password: 'curta' },
    });

    expect(response.statusCode).toBe(400);
    expect(registerOrganizationOwner).not.toHaveBeenCalled();
  });

  it('returns conflict when the email is already registered', async () => {
    const registerOrganizationOwner = vi.fn().mockRejectedValue(new EmailAlreadyRegisteredError());
    const app = buildApp({ registerOrganizationOwner });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        organizationName: 'Barbearia Central',
        name: 'Marcelo Luan',
        email: 'marcelo@example.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: 'E-mail já cadastrado.' });
  });
});

describe('POST /auth/login', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  const mockUser = {
    id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
    name: 'Marcelo Luan',
    email: 'marcelo@example.com',
    role: 'OWNER' as const,
    organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
  };

  it('returns 200, JWT and safe user data for valid credentials', async () => {
    const loginUser = vi.fn().mockResolvedValue({
      token: 'jwt.token.valido',
      user: mockUser,
    });
    const app = buildApp({ loginUser });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'marcelo@example.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBe('jwt.token.valido');
    expect(body.user).toEqual(mockUser);
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('password');
    expect(loginUser).toHaveBeenCalledOnce();
  });

  it('returns 401 when the password is invalid without revealing details', async () => {
    const loginUser = vi.fn().mockRejectedValue(new InvalidCredentialsError());
    const app = buildApp({ loginUser });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'marcelo@example.com',
        password: 'senha-errada',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'E-mail ou senha inválidos.' });
  });

  it('returns 401 when the user does not exist without revealing details', async () => {
    const loginUser = vi.fn().mockRejectedValue(new InvalidCredentialsError());
    const app = buildApp({ loginUser });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'inexistente@example.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'E-mail ou senha inválidos.' });
  });

  it('returns 400 when input data is invalid', async () => {
    const loginUser = vi.fn();
    const app = buildApp({ loginUser });
    apps.add(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'email-invalido',
        password: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('issues');
    expect(loginUser).not.toHaveBeenCalled();
  });
});

describe('GET /auth/me', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();
  const jwtSecret = 'segredo-de-teste-auth-me';

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  const mockUser = {
    id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
    name: 'Marcelo Luan',
    email: 'marcelo@example.com',
    role: 'OWNER' as const,
    organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
  };

  it('returns 401 when authorization header is missing', async () => {
    const app = buildApp({ jwtSecret });
    apps.add(app);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: 'Token de autenticação não fornecido ou inválido.',
    });
  });

  it('returns 401 when token is invalid or malformed', async () => {
    const app = buildApp({ jwtSecret });
    apps.add(app);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: 'Bearer token-invalido-123',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: 'Token de autenticação não fornecido ou inválido.',
    });
  });

  it('returns 200 and authenticated user without passwordHash with valid token', async () => {
    const app = buildApp({ jwtSecret });
    apps.add(app);

    const token = signJwt(mockUser, jwtSecret);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ user: mockUser });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('password');
  });
});
