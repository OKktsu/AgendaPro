import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from 'google-auth-library';

import type { prisma } from '../database/prisma.js';
import { verifyJwt } from './jwt.js';
import { InvalidCredentialsError } from './login.js';
import {
  GoogleAuthenticationUnavailableError,
  GoogleRegistrationRequiredError,
  InvalidGoogleCredentialError,
  loginWithGoogleIdentity,
  verifyGoogleCredential,
} from './google.js';

const clientId = 'agendapro-test-client.apps.googleusercontent.com';
const jwtSecret = 'google-login-test-secret';
const user = {
  id: '60d98c58-1684-4a11-987c-cf19f7e526c9',
  name: 'Marcelo Luan',
  email: 'marcelo@example.com',
  role: 'OWNER' as const,
  organizationId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
  googleSubject: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyGoogleCredential', () => {
  it('verifies the token audience and returns a normalized verified identity', async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({
      getPayload: () => ({
        sub: 'google-subject-123',
        email: ' MARCELO@EXAMPLE.COM ',
        email_verified: true,
        iss: 'https://accounts.google.com',
      }),
    });
    const verifier = { verifyIdToken } as unknown as OAuth2Client;

    await expect(verifyGoogleCredential('google-id-token', clientId, verifier)).resolves.toEqual({
      subject: 'google-subject-123',
      email: 'marcelo@example.com',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'google-id-token', audience: clientId });
  });

  it('rejects a token whose Google email is not verified', async () => {
    const verifier = {
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google-subject-123',
          email: 'marcelo@example.com',
          email_verified: false,
          iss: 'https://accounts.google.com',
        }),
      }),
    } as unknown as OAuth2Client;

    await expect(verifyGoogleCredential('google-id-token', clientId, verifier)).rejects.toThrow(
      InvalidGoogleCredentialError,
    );
  });

  it('does not attempt verification without a configured client ID', async () => {
    await expect(verifyGoogleCredential('google-id-token', undefined)).rejects.toThrow(
      GoogleAuthenticationUnavailableError,
    );
  });

  it('converts invalid signatures or audiences into a credential error', async () => {
    const verifier = {
      verifyIdToken: vi.fn().mockRejectedValue(new Error('invalid aud')),
    } as unknown as OAuth2Client;

    await expect(verifyGoogleCredential('google-id-token', clientId, verifier)).rejects.toThrow(
      InvalidGoogleCredentialError,
    );
  });
});

describe('loginWithGoogleIdentity', () => {
  it('links a verified Google subject to an existing account and returns the AgendaPro JWT', async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { user: { findUnique, updateMany } } as unknown as typeof prisma;

    const result = await loginWithGoogleIdentity(
      { subject: 'google-subject-123', email: user.email },
      jwtSecret,
      db,
    );

    expect(result.user).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    });
    expect(verifyJwt(result.token, jwtSecret)).toMatchObject(result.user);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: user.id, googleSubject: null },
      data: { googleSubject: 'google-subject-123' },
    });
  });

  it('requests onboarding for Google identities without an existing account', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const db = { user: { findUnique, updateMany: vi.fn() } } as unknown as typeof prisma;

    await expect(
      loginWithGoogleIdentity(
        { subject: 'google-subject-123', email: 'unknown@example.com' },
        jwtSecret,
        db,
      ),
    ).rejects.toThrow(GoogleRegistrationRequiredError);
  });

  it('does not replace a different Google subject already linked to the account', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...user,
        googleSubject: 'another-google-subject',
      });
    const db = { user: { findUnique, updateMany: vi.fn() } } as unknown as typeof prisma;

    await expect(
      loginWithGoogleIdentity({ subject: 'google-subject-123', email: user.email }, jwtSecret, db),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('uses the stable Google subject for an already linked account', async () => {
    const linkedUser = {
      ...user,
      email: 'old-email@example.com',
      googleSubject: 'google-subject-123',
    };
    const findUnique = vi.fn().mockResolvedValueOnce(linkedUser);
    const updateMany = vi.fn();
    const db = { user: { findUnique, updateMany } } as unknown as typeof prisma;

    const result = await loginWithGoogleIdentity(
      { subject: 'google-subject-123', email: 'new-email@example.com' },
      jwtSecret,
      db,
    );

    expect(result.user.email).toBe('old-email@example.com');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('accepts the same Google account if two first logins try to link it concurrently', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ id: user.id });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = { user: { findUnique, updateMany } } as unknown as typeof prisma;

    const result = await loginWithGoogleIdentity(
      { subject: 'google-subject-123', email: user.email },
      jwtSecret,
      db,
    );

    expect(result.user.id).toBe(user.id);
  });
});
