import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailAlreadyRegisteredError } from './auth/register.js';
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
    const registerOrganizationOwner = vi
      .fn()
      .mockRejectedValue(new EmailAlreadyRegisteredError());
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
