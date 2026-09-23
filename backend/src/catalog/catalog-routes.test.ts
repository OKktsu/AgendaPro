import type { Prisma, Professional, ProfessionalService, Service } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { signJwt, type AuthenticatedUser } from '../auth/jwt.js';
import type { CatalogDatabase, ProfessionalWithServices } from './catalog.js';

function createInMemoryCatalogDb(): CatalogDatabase & {
  services: Service[];
  professionals: Professional[];
  professionalServices: ProfessionalService[];
} {
  const services: Service[] = [];
  const professionals: Professional[] = [];
  const professionalServices: ProfessionalService[] = [];

  return {
    services,
    professionals,
    professionalServices,
    service: {
      create: async ({ data }: Prisma.ServiceCreateArgs) => {
        const item: Service = {
          id:
            (data.id as string | undefined) ??
            `60d98c58-1684-4a11-987c-${String(services.length + 1).padStart(12, '0')}`,
          organizationId: data.organizationId as string,
          name: data.name,
          durationMinutes: data.durationMinutes,
          priceInCents: data.priceInCents,
          active: data.active ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        services.push(item);
        return item;
      },
      findMany: async ({ where }: Prisma.ServiceFindManyArgs) => {
        return services.filter((s) => s.organizationId === where?.organizationId);
      },
      findFirst: async ({ where }: Prisma.ServiceFindFirstArgs) => {
        return (
          services.find((s) => s.id === where?.id && s.organizationId === where?.organizationId) ??
          null
        );
      },
    },
    professional: {
      create: async ({ data }: Prisma.ProfessionalCreateArgs) => {
        const item: Professional = {
          id:
            (data.id as string | undefined) ??
            `4e0d9057-4648-44a2-8489-${String(professionals.length + 1).padStart(12, '0')}`,
          organizationId: data.organizationId as string,
          name: data.name,
          active: data.active ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        professionals.push(item);
        return item;
      },
      findMany: async ({
        where,
      }: Prisma.ProfessionalFindManyArgs): Promise<ProfessionalWithServices[]> => {
        const filtered = professionals.filter((p) => p.organizationId === where?.organizationId);
        return filtered.map((p) => ({
          ...p,
          services: professionalServices
            .filter((ps) => ps.professionalId === p.id)
            .map((ps) => ({
              ...ps,
              service: services.find((s) => s.id === ps.serviceId) ?? null,
            })),
        }));
      },
      findFirst: async ({ where }: Prisma.ProfessionalFindFirstArgs) => {
        return (
          professionals.find(
            (p) => p.id === where?.id && p.organizationId === where?.organizationId,
          ) ?? null
        );
      },
    },
    professionalService: {
      upsert: async ({ where, create }: Prisma.ProfessionalServiceUpsertArgs) => {
        const key = where.professionalId_serviceId;
        let existing = professionalServices.find(
          (ps) => ps.professionalId === key?.professionalId && ps.serviceId === key?.serviceId,
        );
        if (!existing) {
          existing = {
            professionalId: create.professionalId as string,
            serviceId: create.serviceId as string,
            createdAt: new Date(),
          };
          professionalServices.push(existing);
        }
        return existing;
      },
    },
  };
}

describe('Rotas de Catálogo e Equipe', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();
  const jwtSecret = 'jwt-secret-test-catalog-routes';

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  const ownerA: AuthenticatedUser = {
    id: 'owner-a-uuid-1111-1111-111111111111',
    name: 'Dono Barbearia A',
    email: 'dono.a@barbearia.com',
    role: 'OWNER',
    organizationId: '11111111-1111-4111-8111-111111111111',
  };

  const staffA: AuthenticatedUser = {
    id: 'staff-a-uuid-1111-1111-111111111112',
    name: 'Atendente A',
    email: 'atendente.a@barbearia.com',
    role: 'STAFF',
    organizationId: '11111111-1111-4111-8111-111111111111',
  };

  const ownerB: AuthenticatedUser = {
    id: 'owner-b-uuid-2222-2222-222222222222',
    name: 'Dono Barbearia B',
    email: 'dono.b@barbearia.com',
    role: 'OWNER',
    organizationId: '22222222-2222-4222-8222-222222222222',
  };

  it('Critério 1: Um OWNER cadastra “Corte”, duração 45 e preço 5000', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const token = signJwt(ownerA, jwtSecret);

    const response = await app.inject({
      method: 'POST',
      url: '/services',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Corte',
        durationMinutes: 45,
        priceInCents: 5000,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('Corte');
    expect(body.durationMinutes).toBe(45);
    expect(body.priceInCents).toBe(5000);
    expect(body.active).toBe(true);
    expect(body.organizationId).toBe(ownerA.organizationId);
  });

  it('Critério 2: Um OWNER cadastra um profissional e o vincula ao serviço', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const token = signJwt(ownerA, jwtSecret);

    // 1. Cadastra o serviço
    const serviceRes = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Corte', durationMinutes: 45, priceInCents: 5000 },
    });
    expect(serviceRes.statusCode).toBe(201);
    const service = serviceRes.json();

    // 2. Cadastra o profissional
    const profRes = await app.inject({
      method: 'POST',
      url: '/professionals',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'João Barbeiro' },
    });
    expect(profRes.statusCode).toBe(201);
    const professional = profRes.json();

    // 3. Vincula o profissional ao serviço
    const linkRes = await app.inject({
      method: 'POST',
      url: `/professionals/${professional.id}/services/${service.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(linkRes.statusCode).toBe(201);
    const linkBody = linkRes.json();
    expect(linkBody.professionalId).toBe(professional.id);
    expect(linkBody.serviceId).toBe(service.id);
    expect(linkBody.message).toContain('sucesso');

    // 4. Verifica na listagem de profissionais que o vínculo está presente
    const listRes = await app.inject({
      method: 'GET',
      url: '/professionals',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.professionals).toHaveLength(1);
    expect(listBody.professionals[0].services).toHaveLength(1);
    expect(listBody.professionals[0].services[0].serviceId).toBe(service.id);
  });

  it('Critério 3: Empresa A não lista, cria vínculo nem acessa dados da empresa B (Isolamento)', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const tokenA = signJwt(ownerA, jwtSecret);
    const tokenB = signJwt(ownerB, jwtSecret);

    // Empresa A cadastra serviço e profissional
    const servARes = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Corte Empresa A', durationMinutes: 30, priceInCents: 4000 },
    });
    const servA = servARes.json();

    const profARes = await app.inject({
      method: 'POST',
      url: '/professionals',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Profissional da Empresa A' },
    });
    const profA = profARes.json();

    // Empresa B cadastra serviço e profissional
    const servBRes = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Barba Empresa B', durationMinutes: 20, priceInCents: 3000 },
    });
    const servB = servBRes.json();

    const profBRes = await app.inject({
      method: 'POST',
      url: '/professionals',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Profissional da Empresa B' },
    });
    const profB = profBRes.json();

    // 1. Empresa A não lista serviços da Empresa B
    const listServicesA = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listServicesA.statusCode).toBe(200);
    const servicesA = listServicesA.json().services as Service[];
    expect(servicesA).toHaveLength(1);
    expect(servicesA[0].name).toBe('Corte Empresa A');
    expect(servicesA.some((s) => s.name === 'Barba Empresa B')).toBe(false);

    // 2. Empresa B não lista serviços da Empresa A
    const listServicesB = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listServicesB.statusCode).toBe(200);
    const servicesB = listServicesB.json().services as Service[];
    expect(servicesB).toHaveLength(1);
    expect(servicesB[0].name).toBe('Barba Empresa B');
    expect(servicesB.some((s) => s.name === 'Corte Empresa A')).toBe(false);

    // 3. Empresa A não lista profissionais da Empresa B
    const listProfA = await app.inject({
      method: 'GET',
      url: '/professionals',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listProfA.statusCode).toBe(200);
    const profsA = listProfA.json().professionals as Professional[];
    expect(profsA).toHaveLength(1);
    expect(profsA[0].name).toBe('Profissional da Empresa A');
    expect(profsA.some((p) => p.name === 'Profissional da Empresa B')).toBe(false);

    // 4. Empresa A NÃO consegue vincular seu profissional a serviço da Empresa B
    const crossLinkRes1 = await app.inject({
      method: 'POST',
      url: `/professionals/${profA.id}/services/${servB.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(crossLinkRes1.statusCode).toBe(404);
    expect(crossLinkRes1.json().message).toMatch(/serviço não encontrado/i);

    // 5. Empresa A NÃO consegue vincular profissional da Empresa B a seu serviço
    const crossLinkRes2 = await app.inject({
      method: 'POST',
      url: `/professionals/${profB.id}/services/${servA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(crossLinkRes2.statusCode).toBe(404);
    expect(crossLinkRes2.json().message).toMatch(/profissional não encontrado/i);

    // 6. Prova de que envio de organizationId adulterado no body ou query é ignorado
    const spoofAttempt = await app.inject({
      method: 'POST',
      url: '/services?organizationId=' + ownerB.organizationId,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Tentativa Invasiva',
        durationMinutes: 30,
        priceInCents: 2000,
        organizationId: ownerB.organizationId,
      },
    });
    expect(spoofAttempt.statusCode).toBe(201);
    expect(spoofAttempt.json().organizationId).toBe(ownerA.organizationId);
    expect(spoofAttempt.json().organizationId).not.toBe(ownerB.organizationId);
  });

  it('Critério 4: Validação de durationMinutes > 0 e priceInCents >= 0', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const token = signJwt(ownerA, jwtSecret);

    // Duração zero é rejeitada
    const zeroDuration = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Corte', durationMinutes: 0, priceInCents: 5000 },
    });
    expect(zeroDuration.statusCode).toBe(400);

    // Duração negativa é rejeitada
    const negativeDuration = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Corte', durationMinutes: -10, priceInCents: 5000 },
    });
    expect(negativeDuration.statusCode).toBe(400);

    // Duração float é rejeitada
    const floatDuration = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Corte', durationMinutes: 45.5, priceInCents: 5000 },
    });
    expect(floatDuration.statusCode).toBe(400);

    // Preço negativo é rejeitado
    const negativePrice = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Corte', durationMinutes: 45, priceInCents: -50 },
    });
    expect(negativePrice.statusCode).toBe(400);

    // Preço float é rejeitado
    const floatPrice = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Corte', durationMinutes: 45, priceInCents: 49.9 },
    });
    expect(floatPrice.statusCode).toBe(400);

    // Preço zero é aceito (serviço gratuito)
    const zeroPrice = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Consulta Grátis', durationMinutes: 15, priceInCents: 0 },
    });
    expect(zeroPrice.statusCode).toBe(201);
  });

  it('Restrição de Papel: apenas OWNER pode criar ou alterar catálogo/equipe', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const staffToken = signJwt(staffA, jwtSecret);

    // STAFF não pode criar serviço
    const postService = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { name: 'Corte', durationMinutes: 30, priceInCents: 4000 },
    });
    expect(postService.statusCode).toBe(403);

    // STAFF não pode criar profissional
    const postProf = await app.inject({
      method: 'POST',
      url: '/professionals',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { name: 'Barbeiro' },
    });
    expect(postProf.statusCode).toBe(403);

    // STAFF não pode vincular profissional a serviço
    const link = await app.inject({
      method: 'POST',
      url: '/professionals/4e0d9057-4648-44a2-8489-3c22098d3a93/services/60d98c58-1684-4a11-987c-cf19f7e526c9',
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(link.statusCode).toBe(403);

    // STAFF pode listar catálogo de sua própria organização
    const getServices = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(getServices.statusCode).toBe(200);

    const getProfessionals = await app.inject({
      method: 'GET',
      url: '/professionals',
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(getProfessionals.statusCode).toBe(200);
  });

  it('Restrição de Autenticação: rotas não autenticadas retornam 401', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const endpoints = [
      {
        method: 'POST' as const,
        url: '/services',
        payload: { name: 'Corte', durationMinutes: 30, priceInCents: 4000 },
      },
      { method: 'GET' as const, url: '/services' },
      { method: 'POST' as const, url: '/professionals', payload: { name: 'Barbeiro' } },
      { method: 'GET' as const, url: '/professionals' },
      {
        method: 'POST' as const,
        url: '/professionals/4e0d9057-4648-44a2-8489-3c22098d3a93/services/60d98c58-1684-4a11-987c-cf19f7e526c9',
      },
    ];

    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: ep.payload,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        message: 'Token de autenticação não fornecido ou inválido.',
      });
    }
  });

  it('Validação de UUID nos parâmetros de rota de vínculo', async () => {
    const catalogDb = createInMemoryCatalogDb();
    const app = buildApp({ jwtSecret, catalogDatabase: catalogDb });
    apps.add(app);

    const token = signJwt(ownerA, jwtSecret);

    const res = await app.inject({
      method: 'POST',
      url: '/professionals/invalido-id/services/outro-invalido',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/parâmetros.*inválidos/i);
  });
});
