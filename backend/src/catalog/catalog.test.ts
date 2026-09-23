import { describe, expect, it, vi } from 'vitest';

import {
  assignProfessionalToService,
  assignServiceParamsSchema,
  createProfessional,
  createProfessionalSchema,
  createService,
  createServiceSchema,
  listProfessionals,
  listServices,
  NotFoundError,
  type CatalogDatabase,
} from './catalog.js';

describe('Validação de esquemas do catálogo', () => {
  describe('createServiceSchema', () => {
    it('aceita dados válidos de serviço', () => {
      const result = createServiceSchema.safeParse({
        name: 'Corte',
        durationMinutes: 45,
        priceInCents: 5000,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Corte');
        expect(result.data.durationMinutes).toBe(45);
        expect(result.data.priceInCents).toBe(5000);
        expect(result.data.active).toBe(true);
      }
    });

    it('aceita preço zero (serviço gratuito/cortesia)', () => {
      const result = createServiceSchema.safeParse({
        name: 'Avaliação Gratuita',
        durationMinutes: 15,
        priceInCents: 0,
      });

      expect(result.success).toBe(true);
    });

    it('rejeita duração menor ou igual a zero', () => {
      expect(
        createServiceSchema.safeParse({
          name: 'Corte',
          durationMinutes: 0,
          priceInCents: 5000,
        }).success,
      ).toBe(false);

      expect(
        createServiceSchema.safeParse({
          name: 'Corte',
          durationMinutes: -15,
          priceInCents: 5000,
        }).success,
      ).toBe(false);
    });

    it('rejeita duração fracionária (deve ser minutos inteiros)', () => {
      expect(
        createServiceSchema.safeParse({
          name: 'Corte',
          durationMinutes: 45.5,
          priceInCents: 5000,
        }).success,
      ).toBe(false);
    });

    it('rejeita preço em centavos negativo', () => {
      expect(
        createServiceSchema.safeParse({
          name: 'Corte',
          durationMinutes: 45,
          priceInCents: -100,
        }).success,
      ).toBe(false);
    });

    it('rejeita preço em centavos fracionário (nunca float)', () => {
      expect(
        createServiceSchema.safeParse({
          name: 'Corte',
          durationMinutes: 45,
          priceInCents: 49.99,
        }).success,
      ).toBe(false);
    });

    it('rejeita nome vazio ou contendo apenas espaços', () => {
      expect(
        createServiceSchema.safeParse({
          name: '   ',
          durationMinutes: 45,
          priceInCents: 5000,
        }).success,
      ).toBe(false);
    });
  });

  describe('createProfessionalSchema', () => {
    it('aceita dados válidos de profissional', () => {
      const result = createProfessionalSchema.safeParse({
        name: 'Carlos Silva',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Carlos Silva');
        expect(result.data.active).toBe(true);
      }
    });

    it('rejeita nome de profissional vazio', () => {
      expect(
        createProfessionalSchema.safeParse({
          name: '',
        }).success,
      ).toBe(false);
    });
  });

  describe('assignServiceParamsSchema', () => {
    it('aceita UUIDs válidos', () => {
      const result = assignServiceParamsSchema.safeParse({
        professionalId: '4e0d9057-4648-44a2-8489-3c22098d3a93',
        serviceId: '60d98c58-1684-4a11-987c-cf19f7e526c9',
      });

      expect(result.success).toBe(true);
    });

    it('rejeita UUIDs malformatados', () => {
      expect(
        assignServiceParamsSchema.safeParse({
          professionalId: 'invalido',
          serviceId: '60d98c58-1684-4a11-987c-cf19f7e526c9',
        }).success,
      ).toBe(false);
    });
  });
});

describe('Serviços de domínio do catálogo e equipe', () => {
  const orgA = 'org-a-1111-1111-1111-111111111111';
  const orgB = 'org-b-2222-2222-2222-222222222222';

  it('createService cria o serviço associado à organização do contexto', async () => {
    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: 'service-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      professional: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      professionalService: {
        upsert: vi.fn(),
      },
    };

    const service = await createService(
      { name: 'Corte', durationMinutes: 45, priceInCents: 5000, active: true },
      orgA,
      mockDb,
    );

    expect(service.name).toBe('Corte');
    expect(service.organizationId).toBe(orgA);
    expect(mockDb.service.create).toHaveBeenCalledWith({
      data: {
        name: 'Corte',
        durationMinutes: 45,
        priceInCents: 5000,
        active: true,
        organizationId: orgA,
      },
    });
  });

  it('listServices filtra exclusivamente pela organizationId informada', async () => {
    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 's1', name: 'Corte', organizationId: orgA }]),
        findFirst: vi.fn(),
      },
      professional: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      professionalService: {
        upsert: vi.fn(),
      },
    };

    const result = await listServices(orgA, mockDb);

    expect(result).toHaveLength(1);
    expect(mockDb.service.findMany).toHaveBeenCalledWith({
      where: { organizationId: orgA },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('createProfessional cria o profissional associado à organização do contexto', async () => {
    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      professional: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: 'prof-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      professionalService: {
        upsert: vi.fn(),
      },
    };

    const professional = await createProfessional(
      { name: 'Ana Beatriz', active: true },
      orgA,
      mockDb,
    );

    expect(professional.name).toBe('Ana Beatriz');
    expect(mockDb.professional.create).toHaveBeenCalledWith({
      data: {
        name: 'Ana Beatriz',
        active: true,
        organizationId: orgA,
      },
    });
  });

  it('listProfessionals retorna profissionais da organização com serviços incluídos', async () => {
    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      professional: {
        create: vi.fn(),
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: 'p1',
              name: 'Ana Beatriz',
              organizationId: orgA,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              services: [],
            },
          ]),
        findFirst: vi.fn(),
      },
      professionalService: {
        upsert: vi.fn(),
      },
    };

    const result = await listProfessionals(orgA, mockDb);
    expect(result).toHaveLength(1);
    expect(mockDb.professional.findMany).toHaveBeenCalledWith({
      where: { organizationId: orgA },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('assignProfessionalToService vincula profissional e serviço da mesma empresa com sucesso', async () => {
    const profId = 'p1-uuid';
    const servId = 's1-uuid';

    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: servId,
          name: 'Corte',
          organizationId: orgA,
        }),
      },
      professional: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: profId,
          name: 'Ana Beatriz',
          organizationId: orgA,
        }),
      },
      professionalService: {
        upsert: vi.fn().mockResolvedValue({
          professionalId: profId,
          serviceId: servId,
          createdAt: new Date(),
        }),
      },
    };

    const result = await assignProfessionalToService(profId, servId, orgA, mockDb);

    expect(result.professional.id).toBe(profId);
    expect(result.service.id).toBe(servId);
    expect(result.professionalService.professionalId).toBe(profId);
    expect(result.professionalService.serviceId).toBe(servId);
  });

  it('assignProfessionalToService bloqueia tentativa de vincular serviço de outra empresa', async () => {
    const profId = 'p1-uuid';
    const servIdB = 'sB-uuid';

    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn(),
        findMany: vi.fn(),
        // O serviço pertence à orgB, portanto a busca restrita à orgA retorna null
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.organizationId === orgA && where.id === servIdB) {
            return null;
          }
          return { id: servIdB, organizationId: orgB };
        }),
      },
      professional: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: profId,
          organizationId: orgA,
        }),
      },
      professionalService: {
        upsert: vi.fn(),
      },
    };

    await expect(assignProfessionalToService(profId, servIdB, orgA, mockDb)).rejects.toThrow(
      NotFoundError,
    );

    expect(mockDb.professionalService.upsert).not.toHaveBeenCalled();
  });

  it('assignProfessionalToService bloqueia tentativa de vincular profissional de outra empresa', async () => {
    const profIdB = 'pB-uuid';
    const servIdA = 'sA-uuid';

    const mockDb: CatalogDatabase = {
      service: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: servIdA,
          organizationId: orgA,
        }),
      },
      professional: {
        create: vi.fn(),
        findMany: vi.fn(),
        // O profissional pertence à orgB, busca na orgA retorna null
        findFirst: vi.fn().mockResolvedValue(null),
      },
      professionalService: {
        upsert: vi.fn(),
      },
    };

    await expect(assignProfessionalToService(profIdB, servIdA, orgA, mockDb)).rejects.toThrow(
      NotFoundError,
    );

    expect(mockDb.professionalService.upsert).not.toHaveBeenCalled();
  });
});
