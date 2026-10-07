import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import { buildApp } from '../app.js';
import { createAccountsAuth } from '../accounts/auth.js';
import { prisma } from '../database/prisma.js';
import type { DedicatedTenantDatabaseResolver } from '../tenant/dedicated-database.js';
import { GoogleRegistrationRequiredError, InvalidGoogleCredentialError } from './google.js';
import { verifyJwt } from './jwt.js';
import { registerOrganizationOwner } from './register.js';

const identity = { subject: 'google-subject', email: 'verified@example.com', name: 'Google Name' };
const input = {
  organizationName: 'Minha Empresa',
  name: 'Meu Nome',
  email: 'forged@example.com',
  password: 'a-secure-password',
  googleCredential: 'signed-google-token',
};
const user = {
  id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
  name: input.name,
  email: identity.email,
  role: 'OWNER' as const,
  organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
};
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('Google onboarding', () => {
  it('returns verified profile without a session when registration is required', async () => {
    const app = buildApp({
      verifyGoogleCredential: vi.fn().mockResolvedValue(identity),
      loginWithGoogle: vi.fn().mockRejectedValue(new GoogleRegistrationRequiredError(identity)),
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { credential: 'token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'registration_required',
      profile: { email: identity.email, name: identity.name },
    });
  });

  it('reverifies Google on registration and ignores the supplied email and subject', async () => {
    const register = vi.fn().mockResolvedValue({
      organization: { id: user.organizationId, name: input.organizationName },
      user,
    });
    const verify = vi.fn().mockResolvedValue(identity);
    const app = buildApp({
      googleClientId: 'client',
      verifyGoogleCredential: verify,
      registerOrganizationOwner: register,
      jwtSecret: 'test-secret',
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...input, googleSubject: 'forged-subject' },
    });
    expect(response.statusCode).toBe(201);
    expect(verify).toHaveBeenCalledWith(input.googleCredential, 'client');
    expect(register).toHaveBeenCalledWith({ ...input, email: identity.email }, identity);
    expect(verifyJwt(response.json().token, 'test-secret')).toMatchObject(user);
  });

  it('does not create an account when the credential expires or is invalid', async () => {
    const register = vi.fn();
    const app = buildApp({
      verifyGoogleCredential: vi.fn().mockRejectedValue(new InvalidGoogleCredentialError()),
      registerOrganizationOwner: register,
    });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: input });
    expect(response.statusCode).toBe(401);
    expect(register).not.toHaveBeenCalled();
  });

  it('preserves the password registration response without a Google session', async () => {
    const register = vi.fn().mockResolvedValue({ user });
    const verify = vi.fn();
    const app = buildApp({ registerOrganizationOwner: register, verifyGoogleCredential: verify });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...input, googleCredential: undefined },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).not.toHaveProperty('token');
    expect(verify).not.toHaveBeenCalled();
  });

  it('persists the verified subject in the same transaction as the organization and owner', async () => {
    const createUser = vi.fn().mockResolvedValue(user);
    const tx = {
      organization: { create: vi.fn().mockResolvedValue({ id: user.organizationId }) },
      user: { create: createUser },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(
      async (callback: unknown) =>
        (callback as (value: typeof tx) => Promise<unknown>)(tx) as never,
    );
    await registerOrganizationOwner(input, identity);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: identity.email, googleSubject: identity.subject }),
      }),
    );
  });

  it('requests onboarding in Accounts mode only for a missing identity', async () => {
    const accounts = {
      account: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as AccountsClient;
    const resolver = { resolve: vi.fn() } as unknown as DedicatedTenantDatabaseResolver;
    const auth = createAccountsAuth(accounts, resolver, {});
    await expect(auth.loginWithGoogle(identity, 'test-secret')).rejects.toThrow(
      GoogleRegistrationRequiredError,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
