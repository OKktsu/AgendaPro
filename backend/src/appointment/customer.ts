import type { Customer, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';

export const customerParamsSchema = z.object({
  id: z.string().uuid('ID do cliente inválido.'),
});

export const listCustomersQuerySchema = z.object({
  search: z.string().optional(),
  q: z.string().optional(),
});

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

export const updateCustomerSchema = z
  .object({
    name: z
      .string({
        invalid_type_error: 'O nome do cliente deve ser uma string.',
      })
      .trim()
      .min(2, 'O nome deve ter no mínimo 2 caracteres.')
      .max(120, 'O nome deve ter no máximo 120 caracteres.')
      .optional(),
    phone: z
      .string({
        invalid_type_error: 'O telefone deve ser uma string.',
      })
      .trim()
      .min(8, 'O telefone deve ter no mínimo 8 caracteres.')
      .max(20, 'O telefone deve ter no máximo 20 caracteres.')
      .optional(),
    email: z
      .string({
        invalid_type_error: 'O email deve ser uma string.',
      })
      .trim()
      .email('Formato de email inválido.')
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
  })
  .refine(
    (data) => data.name !== undefined || data.phone !== undefined || data.email !== undefined,
    {
      message: 'Pelo menos um campo deve ser informado para atualização.',
    },
  );

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
    update: (args: Prisma.CustomerUpdateArgs) => Promise<Customer>;
  };
};

export type ListCustomersFilter = {
  search?: string;
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

export async function updateCustomer(
  id: string,
  input: z.infer<typeof updateCustomerSchema>,
  organizationId: string,
  db: CustomerDatabase = prisma,
): Promise<Customer> {
  const existing = await db.customer.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw new CustomerNotFoundError();
  }

  const dataToUpdate: Prisma.CustomerUpdateInput = {};
  if (input.name !== undefined) dataToUpdate.name = input.name;
  if (input.phone !== undefined) dataToUpdate.phone = input.phone;
  if (input.email !== undefined) dataToUpdate.email = input.email;

  return await db.customer.update({
    where: { id },
    data: dataToUpdate,
  });
}

export async function listCustomers(
  organizationId: string,
  filterOrDb?: ListCustomersFilter | CustomerDatabase,
  possibleDb: CustomerDatabase = prisma,
): Promise<Customer[]> {
  let filter: ListCustomersFilter | undefined;
  let db: CustomerDatabase = possibleDb;

  if (filterOrDb && 'customer' in filterOrDb) {
    db = filterOrDb as CustomerDatabase;
    filter = undefined;
  } else if (filterOrDb) {
    filter = filterOrDb as ListCustomersFilter;
  }

  const where: Prisma.CustomerWhereInput = {
    organizationId,
  };

  const searchTerm = filter?.search?.trim();
  if (searchTerm) {
    where.OR = [
      { name: { contains: searchTerm, mode: 'insensitive' } },
      { phone: { contains: searchTerm, mode: 'insensitive' } },
      { email: { contains: searchTerm, mode: 'insensitive' } },
    ];
  }

  return await db.customer.findMany({
    where,
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
