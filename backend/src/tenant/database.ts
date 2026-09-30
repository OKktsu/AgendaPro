import type { CatalogDatabase } from '../catalog/catalog.js';
import type { CustomerDatabase } from '../appointment/customer.js';
import type { AppointmentDatabase } from '../appointment/appointment.js';
import type { WorkScheduleDatabase } from '../schedule/work-schedule.js';
import type { AvailabilityDatabase } from '../schedule/availability.js';
import { prisma } from '../database/prisma.js';
import type { TenantContext } from './context.js';

export type TenantDatabase = CatalogDatabase &
  CustomerDatabase &
  AppointmentDatabase &
  WorkScheduleDatabase &
  AvailabilityDatabase & { $disconnect(): Promise<void> };

export type TenantDatabaseResolver = {
  resolve(context: TenantContext): Promise<TenantDatabase>;
};

/** Compatibilidade durante a transição: os filtros de organização continuam obrigatórios. */
export const sharedTenantDatabaseResolver: TenantDatabaseResolver = {
  async resolve(context) {
    if (!context.organizationId || !context.userId) {
      throw new Error('Contexto autenticado obrigatório.');
    }
    return prisma;
  },
};
