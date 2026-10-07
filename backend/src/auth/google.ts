import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';
import { type AuthenticatedUser, signJwt } from './jwt.js';
import { InvalidCredentialsError } from './login.js';

export const googleLoginBodySchema = z.object({
  credential: z.string().min(1).max(10_000),
});

export type GoogleIdentity = {
  subject: string;
  email: string;
  name?: string;
};

export class GoogleRegistrationRequiredError extends Error {
  constructor(readonly identity: GoogleIdentity) {
    super('Conclua seu cadastro para começar.');
  }
}

export class InvalidGoogleCredentialError extends Error {
  constructor() {
    super('Credencial do Google inválida.');
    this.name = 'InvalidGoogleCredentialError';
  }
}

export class GoogleAuthenticationUnavailableError extends Error {
  constructor() {
    super('Login com Google não está configurado neste ambiente.');
    this.name = 'GoogleAuthenticationUnavailableError';
  }
}

export async function verifyGoogleCredential(
  credential: string,
  clientId: string | undefined,
  verifier = clientId ? new OAuth2Client(clientId) : undefined,
): Promise<GoogleIdentity> {
  if (!clientId || !verifier) {
    throw new GoogleAuthenticationUnavailableError();
  }

  try {
    const ticket = await verifier.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();

    if (
      !payload?.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com')
    ) {
      throw new InvalidGoogleCredentialError();
    }

    return {
      subject: payload.sub,
      email: payload.email.trim().toLowerCase(),
      ...(payload.name ? { name: payload.name } : {}),
    };
  } catch (error) {
    if (error instanceof InvalidGoogleCredentialError) {
      throw error;
    }

    throw new InvalidGoogleCredentialError();
  }
}

type GoogleLoginDatabase = typeof prisma;

export async function loginWithGoogleIdentity(
  identity: GoogleIdentity,
  jwtSecret = process.env.JWT_SECRET ?? 'agendapro-dev-secret-change-in-production',
  db: GoogleLoginDatabase = prisma,
) {
  const select = {
    id: true,
    name: true,
    email: true,
    role: true,
    organizationId: true,
    googleSubject: true,
  } as const;

  const linkedAccount = await db.user.findUnique({
    where: { googleSubject: identity.subject },
    select,
  });
  const user =
    linkedAccount ?? (await db.user.findUnique({ where: { email: identity.email }, select }));

  if (!user) {
    throw new GoogleRegistrationRequiredError(identity);
  }

  if (!linkedAccount && user.email !== identity.email) {
    throw new InvalidCredentialsError();
  }

  if (user.googleSubject && user.googleSubject !== identity.subject) {
    throw new InvalidCredentialsError();
  }

  if (!user.googleSubject) {
    const linked = await db.user.updateMany({
      where: { id: user.id, googleSubject: null },
      data: { googleSubject: identity.subject },
    });

    if (linked.count !== 1) {
      const concurrentLink = await db.user.findUnique({
        where: { googleSubject: identity.subject },
        select: { id: true },
      });

      if (concurrentLink?.id !== user.id) {
        throw new InvalidCredentialsError();
      }
    }
  }

  const safeUser: AuthenticatedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };

  return { user: safeUser, token: signJwt(safeUser, jwtSecret) };
}
