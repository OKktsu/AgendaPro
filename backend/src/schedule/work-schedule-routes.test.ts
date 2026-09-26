import type { Prisma, Professional, ProfessionalWorkSchedule, Weekday } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { signJwt, type AuthenticatedUser } from '../auth/jwt.js';
import type { WorkScheduleDatabase } from './work-schedule.js';

function createInMemoryWorkScheduleDb(): WorkScheduleDatabase & {
  professionals: Professional[];
  schedules: ProfessionalWorkSchedule[];
} {
  const professionals: Professional[] = [];
  const schedules: ProfessionalWorkSchedule[] = [];

  return {
    professionals,
    schedules,
    professional: {
      findFirst: async ({ where }: Prisma.ProfessionalFindFirstArgs) => {
        return (
          professionals.find(
            (p) => p.id === where?.id && p.organizationId === where?.organizationId,
          ) ?? null
        );
      },
    },
    professionalWorkSchedule: {
      create: async ({ data }: Prisma.ProfessionalWorkScheduleCreateArgs) => {
        const item: ProfessionalWorkSchedule = {
          id:
            (data.id as string | undefined) ??
            `88888888-8888-4888-8888-${String(schedules.length + 1).padStart(12, '0')}`,
          professionalId: data.professionalId as string,
          weekday: data.weekday as Weekday,
          startTime: data.startTime as string,
          endTime: data.endTime as string,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        schedules.push(item);
        return item;
      },
      findMany: async ({ where, orderBy }: Prisma.ProfessionalWorkScheduleFindManyArgs) => {
        let result = schedules.filter((s) => {
          if (where?.professionalId && s.professionalId !== where.professionalId) {
            return false;
          }
          if (where?.weekday && s.weekday !== where.weekday) {
            return false;
          }
          return true;
        });

        if (Array.isArray(orderBy)) {
          result = [...result].sort((a, b) => {
            if (a.weekday !== b.weekday) {
              return a.weekday.localeCompare(b.weekday);
            }
            return a.startTime.localeCompare(b.startTime);
          });
        }

        return result;
      },
      findFirst: async ({ where }: Prisma.ProfessionalWorkScheduleFindFirstArgs) => {
        return schedules.find((s) => s.id === where?.id) ?? null;
      },
      delete: async ({ where }: Prisma.ProfessionalWorkScheduleDeleteArgs) => {
        const index = schedules.findIndex((s) => s.id === where.id);
        if (index === -1) {
          throw new Error('Not found');
        }
        const [deleted] = schedules.splice(index, 1);
        return deleted!;
      },
    },
  };
}

describe('Rotas de Horários de Trabalho (/professionals/:id/work-schedules e /work-schedules/:id)', () => {
  const apps = new Set<ReturnType<typeof buildApp>>();
  const jwtSecret = 'jwt-secret-test-work-schedules';

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
    id: 'staff-a-uuid-2222-2222-222222222222',
    name: 'Staff Barbearia A',
    email: 'staff.a@barbearia.com',
    role: 'STAFF',
    organizationId: '11111111-1111-4111-8111-111111111111',
  };

  const ownerB: AuthenticatedUser = {
    id: 'owner-b-uuid-3333-3333-333333333333',
    name: 'Dono Salão B',
    email: 'dono.b@salao.com',
    role: 'OWNER',
    organizationId: '22222222-2222-4222-8222-222222222222',
  };

  const profOrgA: Professional = {
    id: '44444444-4444-4444-8444-444444444444',
    organizationId: ownerA.organizationId,
    name: 'Barbeiro Carlos',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const profOrgB: Professional = {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: ownerB.organizationId,
    name: 'Cabeleireira Ana',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setupTestApp() {
    const db = createInMemoryWorkScheduleDb();
    db.professionals.push(profOrgA, profOrgB);

    const app = buildApp({
      jwtSecret,
      workScheduleDatabase: db,
    });
    apps.add(app);

    const tokenOwnerA = signJwt(ownerA, jwtSecret);
    const tokenStaffA = signJwt(staffA, jwtSecret);
    const tokenOwnerB = signJwt(ownerB, jwtSecret);

    return { app, db, tokenOwnerA, tokenStaffA, tokenOwnerB };
  }

  it('permite que OWNER cadastre horários no mesmo dia sem sobreposição (ex: segunda 09:00-12:00 e 13:00-18:00)', async () => {
    const { app, tokenOwnerA } = setupTestApp();

    // 1. Cadastra manhã: 09:00 às 12:00
    const res1 = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'MONDAY',
        startTime: '09:00',
        endTime: '12:00',
      },
    });

    expect(res1.statusCode).toBe(201);
    const body1 = JSON.parse(res1.payload);
    expect(body1.weekday).toBe('MONDAY');
    expect(body1.startTime).toBe('09:00');
    expect(body1.endTime).toBe('12:00');
    expect(body1.id).toBeDefined();

    // 2. Cadastra tarde: 13:00 às 18:00 (mesma segunda-feira, sem conflito)
    const res2 = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'segunda-feira', // testando alias amigável
        startTime: '13:00',
        endTime: '18:00',
      },
    });

    expect(res2.statusCode).toBe(201);
    const body2 = JSON.parse(res2.payload);
    expect(body2.weekday).toBe('MONDAY');
    expect(body2.startTime).toBe('13:00');
    expect(body2.endTime).toBe('18:00');

    // 3. Consulta horários cadastrados
    const resList = await app.inject({
      method: 'GET',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });

    expect(resList.statusCode).toBe(200);
    const listBody = JSON.parse(resList.payload);
    expect(listBody.schedules).toHaveLength(2);
    expect(listBody.schedules[0].startTime).toBe('09:00');
    expect(listBody.schedules[1].startTime).toBe('13:00');
  });

  it('não é possível cadastrar 18:00 até 09:00 (startTime >= endTime)', async () => {
    const { app, tokenOwnerA } = setupTestApp();

    const response = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'MONDAY',
        startTime: '18:00',
        endTime: '09:00',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.message).toBe('Dados de horário de trabalho inválidos.');
    expect(body.issues.endTime).toBeDefined();
    expect(body.issues.endTime[0]).toContain('anterior');
  });

  it('rejeita cadastro de faixas sobrepostas ou duplicadas no mesmo dia com 409 Conflict', async () => {
    const { app, tokenOwnerA } = setupTestApp();

    // Cria faixa base: 09:00 às 12:00
    await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'MONDAY',
        startTime: '09:00',
        endTime: '12:00',
      },
    });

    // Tentativa 1: Idêntico (duplicado)
    const resDup = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'MONDAY',
        startTime: '09:00',
        endTime: '12:00',
      },
    });
    expect(resDup.statusCode).toBe(409);
    expect(JSON.parse(resDup.payload).message).toContain('sobreposto');

    // Tentativa 2: Sobreposição parcial (11:00 às 14:00)
    const resOverlap = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'MONDAY',
        startTime: '11:00',
        endTime: '14:00',
      },
    });
    expect(resOverlap.statusCode).toBe(409);

    // Tentativa 3: Faixa contida (10:00 às 11:00)
    const resContained = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'MONDAY',
        startTime: '10:00',
        endTime: '11:00',
      },
    });
    expect(resContained.statusCode).toBe(409);
  });

  it('garante isolamento multitenant: Empresa A não altera ou consulta disponibilidade da Empresa B', async () => {
    const { app, tokenOwnerA, tokenOwnerB, db } = setupTestApp();

    // Cadastra horário para o profissional da Empresa B por Owner B
    const resCreateB = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgB.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerB}` },
      payload: {
        weekday: 'TUESDAY',
        startTime: '08:00',
        endTime: '17:00',
      },
    });
    expect(resCreateB.statusCode).toBe(201);
    const scheduleBId = JSON.parse(resCreateB.payload).id;

    // 1. Empresa A tenta cadastrar horário para profissional da Empresa B -> 404
    const resAttackPost = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgB.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: {
        weekday: 'WEDNESDAY',
        startTime: '10:00',
        endTime: '16:00',
      },
    });
    expect(resAttackPost.statusCode).toBe(404);
    expect(JSON.parse(resAttackPost.payload).message).toContain('Profissional não encontrado');

    // 2. Empresa A tenta listar horários do profissional da Empresa B -> 404
    const resAttackGet = await app.inject({
      method: 'GET',
      url: `/professionals/${profOrgB.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resAttackGet.statusCode).toBe(404);
    expect(JSON.parse(resAttackGet.payload).message).toContain('Profissional não encontrado');

    // 3. Empresa A tenta deletar horário da Empresa B -> 404
    const resAttackDelete = await app.inject({
      method: 'DELETE',
      url: `/work-schedules/${scheduleBId}`,
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resAttackDelete.statusCode).toBe(404);
    expect(JSON.parse(resAttackDelete.payload).message).toContain('não encontrado');

    // 4. Verifica que a disponibilidade da Empresa B permaneceu intacta
    const resCheckB = await app.inject({
      method: 'GET',
      url: `/professionals/${profOrgB.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenOwnerB}` },
    });
    expect(resCheckB.statusCode).toBe(200);
    const bodyCheckB = JSON.parse(resCheckB.payload);
    expect(bodyCheckB.schedules).toHaveLength(1);
    expect(bodyCheckB.schedules[0].id).toBe(scheduleBId);

    // 5. Empresa B consegue deletar seu próprio horário
    const resDeleteB = await app.inject({
      method: 'DELETE',
      url: `/work-schedules/${scheduleBId}`,
      headers: { authorization: `Bearer ${tokenOwnerB}` },
    });
    expect(resDeleteB.statusCode).toBe(200);
    expect(db.schedules).toHaveLength(0);
  });

  it('exige autenticação e papel OWNER para todas as rotas de work-schedules', async () => {
    const { app, tokenStaffA } = setupTestApp();

    // 1. Sem token -> 401
    const resNoTokenPost = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      payload: { weekday: 'MONDAY', startTime: '09:00', endTime: '12:00' },
    });
    expect(resNoTokenPost.statusCode).toBe(401);

    const resNoTokenGet = await app.inject({
      method: 'GET',
      url: `/professionals/${profOrgA.id}/work-schedules`,
    });
    expect(resNoTokenGet.statusCode).toBe(401);

    const resNoTokenDelete = await app.inject({
      method: 'DELETE',
      url: `/work-schedules/66666666-6666-4666-8666-666666666666`,
    });
    expect(resNoTokenDelete.statusCode).toBe(401);

    // 2. Com token de STAFF (não OWNER) -> 403 Forbidden
    const resStaffPost = await app.inject({
      method: 'POST',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenStaffA}` },
      payload: { weekday: 'MONDAY', startTime: '09:00', endTime: '12:00' },
    });
    expect(resStaffPost.statusCode).toBe(403);

    const resStaffGet = await app.inject({
      method: 'GET',
      url: `/professionals/${profOrgA.id}/work-schedules`,
      headers: { authorization: `Bearer ${tokenStaffA}` },
    });
    expect(resStaffGet.statusCode).toBe(403);

    const resStaffDelete = await app.inject({
      method: 'DELETE',
      url: `/work-schedules/66666666-6666-4666-8666-666666666666`,
      headers: { authorization: `Bearer ${tokenStaffA}` },
    });
    expect(resStaffDelete.statusCode).toBe(403);
  });

  it('retorna 400 para parâmetros de rota inválidos (não UUID)', async () => {
    const { app, tokenOwnerA } = setupTestApp();

    const resBadPost = await app.inject({
      method: 'POST',
      url: '/professionals/invalido-id/work-schedules',
      headers: { authorization: `Bearer ${tokenOwnerA}` },
      payload: { weekday: 'MONDAY', startTime: '09:00', endTime: '12:00' },
    });
    expect(resBadPost.statusCode).toBe(400);

    const resBadGet = await app.inject({
      method: 'GET',
      url: '/professionals/invalido-id/work-schedules',
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resBadGet.statusCode).toBe(400);

    const resBadDelete = await app.inject({
      method: 'DELETE',
      url: '/work-schedules/invalido-id',
      headers: { authorization: `Bearer ${tokenOwnerA}` },
    });
    expect(resBadDelete.statusCode).toBe(400);
  });
});
