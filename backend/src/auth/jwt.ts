import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'STAFF';
  organizationId: string;
};

export type JwtPayload = AuthenticatedUser & {
  sub?: string;
  iat?: number;
  exp?: number;
};

export class InvalidTokenError extends Error {
  constructor(message = 'Token inválido ou expirado.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

export function signJwt(user: AuthenticatedUser, secret: string, expiresInSeconds = 86400): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const payload: JwtPayload = {
    ...user,
    sub: user.id,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyJwt(token: string, secret: string): AuthenticatedUser {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InvalidTokenError('Formato de token inválido.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new InvalidTokenError('Token com partes ausentes.');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedSigBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedSigBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedSigBuffer)
  ) {
    throw new InvalidTokenError('Assinatura do token inválida.');
  }

  let payload: JwtPayload;
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    payload = JSON.parse(json);
  } catch {
    throw new InvalidTokenError('Payload do token inválido.');
  }

  if (typeof payload.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp) {
      throw new InvalidTokenError('Token expirado.');
    }
  }

  if (!payload.id || !payload.name || !payload.email || !payload.role || !payload.organizationId) {
    throw new InvalidTokenError('Payload incompleto.');
  }

  return {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    organizationId: payload.organizationId,
  };
}
