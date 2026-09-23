import type { Customer, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';

export const createCustomerSchema = z.object({
  name: z
    .string({
      required_error: 'O nome do cliente é obrigatório.',
      invalid_type_error: 'O nome do cliente deve ser uma string.',
    })
    .trim()
    .min(2, 'O nome deve ter no mínimo 2 caracteres.')
    .max(120, 'O nome deve ter no máximo 120 caracteres.'),
  phone: z
    .string({
      required_error: 'O telefone do cliente é obrigatório.',
      invalid_type_error: 'O telefone deve ser uma string.',
    })
    .trim()
    .min(8, 'O telefone deve ter no mínimo 8 caracteres.')
    .max(20, 'O telefone deve ter no máximo 20 caracteres.'),
  email: z
    .string({
      invalid_type_error: 'O email deve ser uma string.',
    })
    .trim()
    .email('Formato de email inválido.')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
});

export class CustomerNotFoundError extends Error {
  constructor(message: string = 'Cliente não encontrado na organização.') {
    super(message);
    this.name = 'CustomerNotFoundError';
  }
}

export type CustomerDatabase = {
  customer: {
    create: (args: Prisma.CustomerCreateArgs) => Promise<Customer>;
    findFirst: (args: Prisma.CustomerFindFirstArgs) => Promise<Customer | null>;
    findMany: (args: Prisma.CustomerFindManyArgs) => Promise<Customer[]>;
  };
};

export async function createCustomer(
  input: z.infer<typeof createCustomerSchema>,
  organizationId: string,
  db: CustomerDatabase = prisma,
): Promise<Customer> {
  return await db.customer.create({
    data: {
      organizationId,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
    },
  });
}

export async function listCustomers(
  organizationId: string,
  db: CustomerDatabase = prisma,
): Promise<Customer[]> {
  return await db.customer.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  });
}

export async function getCustomer(
  id: string,
  organizationId: string,
  db: CustomerDatabase = prisma,
): Promise<Customer> {
  const customer = await db.customer.findFirst({
    where: { id, organizationId },
  });

  if (!customer) {
    throw new CustomerNotFoundError();
  }

  return customer;
}
