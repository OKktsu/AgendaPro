import { z } from 'zod';

import { prisma } from '../database/prisma.js';
import { type AuthenticatedUser, signJwt } from './jwt.js';
import { verifyPassword } from './register.js';

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(72),
});

export class InvalidCredentialsError extends Error {
  constructor() {
    super('E-mail ou senha inválidos.');
    this.name = 'InvalidCredentialsError';
  }
}

export type LoginUserDatabase = {
  user: {
    findUnique: (args: {
      where: { email: string };
      select: {
        id: true;
        name: true;
        email: true;
        passwordHash: true;
        role: true;
        organizationId: true;
      };
    }) => Promise<{
      id: string;
      name: string;
      email: string;
      passwordHash: string;
      role: 'OWNER' | 'STAFF';
      organizationId: string;
    } | null>;
  };
};

export async function loginUser(
  input: z.infer<typeof loginBodySchema>,
  jwtSecret = process.env.JWT_SECRET ?? 'agendapro-dev-secret-change-in-production',
  db: LoginUserDatabase = prisma,
) {
  const email = input.email.toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      role: true,
      organizationId: true,
    },
  });

  if (!user) {
    throw new InvalidCredentialsError();
  }

  const isPasswordValid = await verifyPassword(input.password, user.passwordHash);

  if (!isPasswordValid) {
    throw new InvalidCredentialsError();
  }

  const safeUser: AuthenticatedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };

  const token = signJwt(safeUser, jwtSecret);

  return {
    token,
    user: safeUser,
  };
}
