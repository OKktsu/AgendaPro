import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';

const scrypt = promisify(scryptCallback);

export const registerBodySchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
});

export async function registerOrganizationOwner(input: z.infer<typeof registerBodySchema>) {
  const email = input.email.toLowerCase();
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: input.organizationName },
      });

      const user = await transaction.user.create({
        data: {
          name: input.name,
          email,
          passwordHash,
          role: 'OWNER',
          organizationId: organization.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationId: true,
        },
      });

      return { organization, user };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new EmailAlreadyRegisteredError();
    }

    throw error;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('E-mail já cadastrado.');
  }
}
