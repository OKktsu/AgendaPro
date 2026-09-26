import { describe, expect, it, vi } from 'vitest';

import {
  createWorkSchedule,
  createWorkScheduleSchema,
  deleteWorkSchedule,
  deleteWorkScheduleParamsSchema,
  isTimeOverlapping,
  listWorkSchedules,
  NotFoundError,
  professionalParamsSchema,
  ScheduleConflictError,
  timeStringSchema,
  weekdaySchema,
  type WorkScheduleDatabase,
} from './work-schedule.js';

describe('Validação de esquemas de horários de trabalho', () => {
  describe('weekdaySchema', () => {
    it('aceita enum canonical em inglês', () => {
      expect(weekdaySchema.parse('MONDAY')).toBe('MONDAY');
      expect(weekdaySchema.parse('TUESDAY')).toBe('TUESDAY');
      expect(weekdaySchema.parse('WEDNESDAY')).toBe('WEDNESDAY');
      expect(weekdaySchema.parse('THURSDAY')).toBe('THURSDAY');
      expect(weekdaySchema.parse('FRIDAY')).toBe('FRIDAY');
      expect(weekdaySchema.parse('SATURDAY')).toBe('SATURDAY');
      expect(weekdaySchema.parse('SUNDAY')).toBe('SUNDAY');
    });

    it('aceita variações em minúsculo e aliases em português', () => {
      expect(weekdaySchema.parse('monday')).toBe('MONDAY');
      expect(weekdaySchema.parse('segunda-feira')).toBe('MONDAY');
      expect(weekdaySchema.parse('segunda')).toBe('MONDAY');
      expect(weekdaySchema.parse('terça-feira')).toBe('TUESDAY');
      expect(weekdaySchema.parse('terca')).toBe('TUESDAY');
      expect(weekdaySchema.parse('quarta-feira')).toBe('WEDNESDAY');
      expect(weekdaySchema.parse('quinta')).toBe('THURSDAY');
      expect(weekdaySchema.parse('sexta-feira')).toBe('FRIDAY');
      expect(weekdaySchema.parse('sábado')).toBe('SATURDAY');
      expect(weekdaySchema.parse('sabado')).toBe('SATURDAY');
      expect(weekdaySchema.parse('domingo')).toBe('SUNDAY');
    });

    it('rejeita dia da semana inválido', () => {
      const result = weekdaySchema.safeParse('invalido');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Dia da semana inválido.');
      }
    });
  });

  describe('timeStringSchema', () => {
    it('aceita horários válidos no formato HH:mm', () => {
      expect(timeStringSchema.parse('00:00')).toBe('00:00');
      expect(timeStringSchema.parse('09:00')).toBe('09:00');
      expect(timeStringSchema.parse('12:30')).toBe('12:30');
      expect(timeStringSchema.parse('23:59')).toBe('23:59');
    });

    it('rejeita formatos incorretos ou fora da faixa de 24h', () => {
      expect(timeStringSchema.safeParse('9:00').success).toBe(false);
      expect(timeStringSchema.safeParse('24:00').success).toBe(false);
      expect(timeStringSchema.safeParse('12:60').success).toBe(false);
      expect(timeStringSchema.safeParse('25:10').success).toBe(false);
      expect(timeStringSchema.safeParse('18h00').success).toBe(false);
      expect(timeStringSchema.safeParse('').success).toBe(false);
    });
  });

  describe('createWorkScheduleSchema', () => {
    it('aceita faixa válida onde startTime < endTime', () => {
      const result = createWorkScheduleSchema.safeParse({
        weekday: 'MONDAY',
        startTime: '09:00',
        endTime: '12:00',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.weekday).toBe('MONDAY');
        expect(result.data.startTime).toBe('09:00');
        expect(result.data.endTime).toBe('12:00');
      }
    });

    it('rejeita quando startTime é maior que endTime (ex: 18:00 até 09:00)', () => {
      const result = createWorkScheduleSchema.safeParse({
        weekday: 'MONDAY',
        startTime: '18:00',
        endTime: '09:00',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'O horário de início deve ser anterior ao horário de término.',
        );
        expect(result.error.issues[0]?.path).toContain('endTime');
      }
    });

    it('rejeita quando startTime é igual a endTime (ex: 10:00 até 10:00)', () => {
      const result = createWorkScheduleSchema.safeParse({
        weekday: 'MONDAY',
        startTime: '10:00',
        endTime: '10:00',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'O horário de início deve ser anterior ao horário de término.',
        );
      }
    });
  });

  describe('UUID params schemas', () => {
    it('valida UUID válido para professionalId', () => {
      expect(
        professionalParamsSchema.safeParse({
          professionalId: '11111111-1111-4111-8111-111111111111',
        }).success,
      ).toBe(true);

      expect(
        professionalParamsSchema.safeParse({
          professionalId: 'invalido',
        }).success,
      ).toBe(false);
    });

    it('valida UUID válido para deleteWorkScheduleParamsSchema', () => {
      expect(
        deleteWorkScheduleParamsSchema.safeParse({
          id: '22222222-2222-4222-8222-222222222222',
        }).success,
      ).toBe(true);

      expect(
        deleteWorkScheduleParamsSchema.safeParse({
          id: 'invalido',
        }).success,
      ).toBe(false);
    });
  });
});

describe('Função de verificação de sobreposição isTimeOverlapping', () => {
  it('identifica que faixas separadas não se sobrepõem', () => {
    // 09:00-12:00 e 13:00-18:00
    expect(
      isTimeOverlapping(
        { startTime: '09:00', endTime: '12:00' },
        { startTime: '13:00', endTime: '18:00' },
      ),
    ).toBe(false);

    expect(
      isTimeOverlapping(
        { startTime: '13:00', endTime: '18:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(false);
  });

  it('identifica que faixas contíguas/adjacentes não se sobrepõem', () => {
    // 09:00-12:00 e 12:00-15:00
    expect(
      isTimeOverlapping(
        { startTime: '09:00', endTime: '12:00' },
        { startTime: '12:00', endTime: '15:00' },
      ),
    ).toBe(false);

    expect(
      isTimeOverlapping(
        { startTime: '12:00', endTime: '15:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(false);
  });

  it('identifica sobreposição quando faixas são idênticas (duplicadas)', () => {
    expect(
      isTimeOverlapping(
        { startTime: '09:00', endTime: '12:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(true);
  });

  it('identifica sobreposição quando uma faixa está contida dentro da outra', () => {
    // 09:00-12:00 contém 10:00-11:00
    expect(
      isTimeOverlapping(
        { startTime: '09:00', endTime: '12:00' },
        { startTime: '10:00', endTime: '11:00' },
      ),
    ).toBe(true);

    expect(
      isTimeOverlapping(
        { startTime: '10:00', endTime: '11:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(true);
  });

  it('identifica sobreposição parcial (inicia antes e termina dentro)', () => {
    expect(
      isTimeOverlapping(
        { startTime: '08:00', endTime: '10:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(true);
  });

  it('identifica sobreposição parcial (inicia dentro e termina depois)', () => {
    expect(
      isTimeOverlapping(
        { startTime: '11:00', endTime: '13:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(true);
  });

  it('identifica sobreposição quando engloba a outra faixa completamente', () => {
    expect(
      isTimeOverlapping(
        { startTime: '08:00', endTime: '14:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(true);
  });
});

describe('Serviço de horários de trabalho', () => {
  const orgIdA = '11111111-1111-4111-8111-111111111111';
  const orgIdB = '22222222-2222-4222-8222-222222222222';
  const profIdA = '33333333-3333-4333-8333-333333333333';

  it('cria horário de trabalho com sucesso', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue({
          id: profIdA,
          organizationId: orgIdA,
          name: 'Barbeiro Silva',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      professionalWorkSchedule: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({
          id: 'schedule-1',
          professionalId: profIdA,
          weekday: 'MONDAY',
          startTime: '09:00',
          endTime: '12:00',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    const result = await createWorkSchedule(
      { weekday: 'MONDAY', startTime: '09:00', endTime: '12:00' },
      profIdA,
      orgIdA,
      mockDb,
    );

    expect(result.id).toBe('schedule-1');
    expect(result.startTime).toBe('09:00');
    expect(result.endTime).toBe('12:00');
    expect(mockDb.professionalWorkSchedule.create).toHaveBeenCalledWith({
      data: {
        professionalId: profIdA,
        weekday: 'MONDAY',
        startTime: '09:00',
        endTime: '12:00',
      },
    });
  });

  it('rejeita cadastro se o profissional não pertence à organização', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      professionalWorkSchedule: {
        findMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    await expect(
      createWorkSchedule(
        { weekday: 'MONDAY', startTime: '09:00', endTime: '12:00' },
        profIdA,
        orgIdB,
        mockDb,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejeita cadastro se houver faixa sobreposta no mesmo dia', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue({
          id: profIdA,
          organizationId: orgIdA,
          name: 'Barbeiro Silva',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      professionalWorkSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule-1',
            professionalId: profIdA,
            weekday: 'MONDAY',
            startTime: '09:00',
            endTime: '12:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        create: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    await expect(
      createWorkSchedule(
        { weekday: 'MONDAY', startTime: '11:00', endTime: '14:00' },
        profIdA,
        orgIdA,
        mockDb,
      ),
    ).rejects.toThrow(ScheduleConflictError);
  });

  it('permite cadastro de múltiplos horários no mesmo dia sem sobreposição (ex: manhã e tarde)', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue({
          id: profIdA,
          organizationId: orgIdA,
          name: 'Barbeiro Silva',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      professionalWorkSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule-morning',
            professionalId: profIdA,
            weekday: 'MONDAY',
            startTime: '09:00',
            endTime: '12:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        create: vi.fn().mockResolvedValue({
          id: 'schedule-afternoon',
          professionalId: profIdA,
          weekday: 'MONDAY',
          startTime: '13:00',
          endTime: '18:00',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    const afternoon = await createWorkSchedule(
      { weekday: 'MONDAY', startTime: '13:00', endTime: '18:00' },
      profIdA,
      orgIdA,
      mockDb,
    );

    expect(afternoon.id).toBe('schedule-afternoon');
    expect(afternoon.startTime).toBe('13:00');
    expect(afternoon.endTime).toBe('18:00');
  });

  it('permite mesmo horário em dias da semana distintos', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue({
          id: profIdA,
          organizationId: orgIdA,
          name: 'Barbeiro Silva',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      professionalWorkSchedule: {
        findMany: vi.fn().mockResolvedValue([]), // Nenhum horário para TUESDAY
        create: vi.fn().mockResolvedValue({
          id: 'schedule-tuesday',
          professionalId: profIdA,
          weekday: 'TUESDAY',
          startTime: '09:00',
          endTime: '12:00',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    const result = await createWorkSchedule(
      { weekday: 'TUESDAY', startTime: '09:00', endTime: '12:00' },
      profIdA,
      orgIdA,
      mockDb,
    );

    expect(result.weekday).toBe('TUESDAY');
  });

  it('lista horários do profissional na organização', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue({
          id: profIdA,
          organizationId: orgIdA,
          name: 'Barbeiro Silva',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      professionalWorkSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule-1',
            professionalId: profIdA,
            weekday: 'MONDAY',
            startTime: '09:00',
            endTime: '12:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'schedule-2',
            professionalId: profIdA,
            weekday: 'MONDAY',
            startTime: '13:00',
            endTime: '18:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        create: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    const list = await listWorkSchedules(profIdA, orgIdA, mockDb);
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe('schedule-1');
    expect(list[1]?.id).toBe('schedule-2');
  });

  it('rejeita listagem se profissional não pertencer à organização', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      professionalWorkSchedule: {
        findMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
    };

    await expect(listWorkSchedules(profIdA, orgIdB, mockDb)).rejects.toThrow(NotFoundError);
  });

  it('exclui horário de trabalho existente pertencente à organização', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue({
          id: profIdA,
          organizationId: orgIdA,
        }),
      },
      professionalWorkSchedule: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'schedule-1',
          professionalId: profIdA,
          weekday: 'MONDAY',
          startTime: '09:00',
          endTime: '12:00',
        }),
        delete: vi.fn().mockResolvedValue({
          id: 'schedule-1',
          professionalId: profIdA,
          weekday: 'MONDAY',
          startTime: '09:00',
          endTime: '12:00',
        }),
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };

    const deleted = await deleteWorkSchedule('schedule-1', orgIdA, mockDb);
    expect(deleted.id).toBe('schedule-1');
    expect(mockDb.professionalWorkSchedule.delete).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
    });
  });

  it('rejeita exclusão se o horário não existir', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn(),
      },
      professionalWorkSchedule: {
        findFirst: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };

    await expect(deleteWorkSchedule('inexistente', orgIdA, mockDb)).rejects.toThrow(NotFoundError);
  });

  it('rejeita exclusão se o profissional do horário pertencer a outra organização', async () => {
    const mockDb: WorkScheduleDatabase = {
      professional: {
        findFirst: vi.fn().mockResolvedValue(null), // não encontrado para orgIdB
      },
      professionalWorkSchedule: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'schedule-1',
          professionalId: profIdA, // pertence a orgIdA
        }),
        delete: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };

    await expect(deleteWorkSchedule('schedule-1', orgIdB, mockDb)).rejects.toThrow(NotFoundError);
  });
});
