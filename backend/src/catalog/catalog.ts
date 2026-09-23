import type { Prisma, Professional, ProfessionalService, Service } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../database/prisma.js';

export const createServiceSchema = z.object({
  name: z.string().trim().min(1, 'O nome do serviço é obrigatório.').max(120),
  durationMinutes: z
    .number({
      required_error: 'A duração é obrigatória.',
      invalid_type_error: 'A duração deve ser um número inteiro em minutos.',
    })
    .int('A duração deve ser um número inteiro de minutos.')
    .positive('A duração deve ser maior que zero.'),
  priceInCents: z
    .number({
      required_error: 'O preço é obrigatório.',
      invalid_type_error: 'O preço deve ser um número inteiro em centavos.',
    })
    .int('O preço deve ser um número inteiro em centavos.')
    .min(0, 'O preço deve ser maior ou igual a zero.'),
  active: z.boolean().optional().default(true),
});

export const createProfessionalSchema = z.object({
  name: z.string().trim().min(1, 'O nome do profissional é obrigatório.').max(120),
  active: z.boolean().optional().default(true),
});

export const assignServiceParamsSchema = z.object({
  professionalId: z.string().uuid('ID do profissional inválido.'),
  serviceId: z.string().uuid('ID do serviço inválido.'),
});

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export type ProfessionalWithServices = Professional & {
  services?: Array<ProfessionalService & { service?: Service | null }>;
};

export type CatalogDatabase = {
  service: {
    create: (args: Prisma.ServiceCreateArgs) => Promise<Service>;
    findMany: (args: Prisma.ServiceFindManyArgs) => Promise<Service[]>;
    findFirst: (args: Prisma.ServiceFindFirstArgs) => Promise<Service | null>;
  };
  professional: {
    create: (args: Prisma.ProfessionalCreateArgs) => Promise<Professional>;
    findMany: (args: Prisma.ProfessionalFindManyArgs) => Promise<ProfessionalWithServices[]>;
    findFirst: (args: Prisma.ProfessionalFindFirstArgs) => Promise<Professional | null>;
  };
  professionalService: {
    create?: (args: Prisma.ProfessionalServiceCreateArgs) => Promise<ProfessionalService>;
    upsert: (args: Prisma.ProfessionalServiceUpsertArgs) => Promise<ProfessionalService>;
    findUnique?: (
      args: Prisma.ProfessionalServiceFindUniqueArgs,
    ) => Promise<ProfessionalService | null>;
  };
};

export async function createService(
  input: z.infer<typeof createServiceSchema>,
  organizationId: string,
  db: CatalogDatabase = prisma,
) {
  return await db.service.create({
    data: {
      name: input.name,
      durationMinutes: input.durationMinutes,
      priceInCents: input.priceInCents,
      active: input.active ?? true,
      organizationId,
    },
  });
}

export async function listServices(organizationId: string, db: CatalogDatabase = prisma) {
  return await db.service.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createProfessional(
  input: z.infer<typeof createProfessionalSchema>,
  organizationId: string,
  db: CatalogDatabase = prisma,
) {
  return await db.professional.create({
    data: {
      name: input.name,
      active: input.active ?? true,
      organizationId,
    },
  });
}

export async function listProfessionals(organizationId: string, db: CatalogDatabase = prisma) {
  return await db.professional.findMany({
    where: { organizationId },
    include: {
      services: {
        include: {
          service: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function assignProfessionalToService(
  professionalId: string,
  serviceId: string,
  organizationId: string,
  db: CatalogDatabase = prisma,
) {
  const professional = await db.professional.findFirst({
    where: {
      id: professionalId,
      organizationId,
    },
  });

  if (!professional) {
    throw new NotFoundError('Profissional não encontrado na organização.');
  }

  const service = await db.service.findFirst({
    where: {
      id: serviceId,
      organizationId,
    },
  });

  if (!service) {
    throw new NotFoundError('Serviço não encontrado na organização.');
  }

  const professionalService = await db.professionalService.upsert({
    where: {
      professionalId_serviceId: {
        professionalId,
        serviceId,
      },
    },
    create: {
      professionalId,
      serviceId,
    },
    update: {},
  });

  return {
    professional,
    service,
    professionalService,
  };
}
