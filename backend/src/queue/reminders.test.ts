import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  reminderSchedule,
  recordReminder,
  markQueued,
  processStoredReminder,
  type ReminderSql,
} from './reminder-store.js';
import {
  dispatchReminders,
  processReminder,
  reminderDataSchema,
  type ReminderDatabases,
} from './reminders.js';

const ids = { organizationId: randomUUID(), appointmentId: randomUUID(), reminderId: randomUUID() };
const now = new Date('2026-10-10T12:00:00Z');
function setup() {
  const query = vi.fn().mockResolvedValue([]);
  const execute = vi.fn().mockResolvedValue(1);
  const db: ReminderSql = { $queryRaw: query, $executeRaw: execute };
  const resolve = vi.fn().mockResolvedValue(db);
  const databases: ReminderDatabases = {
    organizations: async () => [ids.organizationId],
    resolve,
    close: async () => {},
  };
  return { query, execute, resolve, db, databases };
}
describe('agendamento do lembrete', () => {
  it('agenda 24h antes quando há antecedência', () => {
    expect(reminderSchedule(new Date('2026-10-12T12:00:00Z'), now)).toEqual({
      dueAt: new Date('2026-10-11T12:00:00Z'),
      status: 'PENDING',
    });
  });
  it('processa assim que possível uma reserva com menos de 24h', () => {
    expect(reminderSchedule(new Date('2026-10-10T13:00:00Z'), now)).toEqual({
      dueAt: now,
      status: 'PENDING',
    });
  });
  it.each(['2026-10-10T11:00:00Z', '2026-10-10T12:00:00Z'])(
    'não agenda reserva passada: %s',
    (date) => {
      expect(reminderSchedule(new Date(date), now).status).toBe('SKIPPED');
    },
  );
  it('grava o pedido usando parâmetros SQL e sem dados do cliente', async () => {
    const { db, execute } = setup();
    await recordReminder(
      db,
      {
        id: ids.appointmentId,
        organizationId: ids.organizationId,
        startsAt: new Date('2026-10-12T12:00:00Z'),
      },
      now,
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0].slice(1)).toContain(ids.organizationId);
    expect(execute.mock.calls[0].slice(1)).toContain(ids.appointmentId);
  });
});
describe('contrato e processamento de lembretes', () => {
  it('não conclui cedo demais um pedido ainda pendente', async () => {
    const { db, query, execute } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ delayMs: 1000 }]);
    await expect(processStoredReminder(db, { id: ids.reminderId, ...ids })).rejects.toThrow(
      'Lembrete ainda não está no horário',
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it('aceita somente identificadores, sem connection string', () => {
    expect(reminderDataSchema.safeParse(ids).success).toBe(true);
    expect(reminderDataSchema.safeParse({ ...ids, connectionString: 'secret' }).success).toBe(
      false,
    );
  });
  it.each([
    { name: 'other', data: ids },
    { name: 'reminder', data: { ...ids, organizationId: 'invalid' } },
  ])('rejeita trabalho inválido antes de resolver a base', async (job) => {
    const { databases, resolve } = setup();
    await expect(processReminder(job, databases)).rejects.toThrow('Lembrete inválido');
    expect(resolve).not.toHaveBeenCalled();
  });
  it('não usa fallback quando tenant está indisponível', async () => {
    const { databases, resolve, query } = setup();
    resolve.mockResolvedValue(null);
    await expect(processReminder({ name: 'reminder', data: ids }, databases)).rejects.toThrow(
      'Base do lembrete indisponível',
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('resolve somente a organização indicada e usa atualização atômica', async () => {
    const { databases, resolve, query, execute } = setup();
    query.mockResolvedValue([{ id: ids.reminderId }]);
    expect(await processReminder({ name: 'reminder', data: ids }, databases)).toBe('processed');
    expect(resolve).toHaveBeenCalledWith(ids.organizationId);
    expect(query.mock.calls[0].slice(1)).toEqual([
      ids.reminderId,
      ids.organizationId,
      ids.appointmentId,
    ]);
    expect(execute).not.toHaveBeenCalled();
  });
  it('ignora reserva inválida ou trabalho já processado', async () => {
    const { db, execute } = setup();
    expect(await processStoredReminder(db, { id: ids.reminderId, ...ids })).toBe('skipped');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('a confirmação de envio não sobrescreve estados terminais', async () => {
    const { db, execute } = setup();
    await markQueued(db, { id: ids.reminderId, ...ids, dueAt: now });
    expect(execute.mock.calls[0][0].join('')).toContain("\"status\" IN ('PENDING', 'QUEUED')");
  });
});
describe('ponte PostgreSQL para Redis', () => {
  it('publica com ID estável e confirma apenas após queue.add', async () => {
    const { query, execute, databases } = setup();
    query.mockResolvedValue([{ id: ids.reminderId, ...ids, dueAt: new Date(0) }]);
    const add = vi.fn().mockResolvedValue({});
    await dispatchReminders(databases, { add });
    expect(add).toHaveBeenCalledWith('reminder', ids, { jobId: ids.reminderId, delay: 0 });
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
  });
  it('não confirma o pedido se Redis falhar', async () => {
    const { query, execute, databases } = setup();
    query.mockResolvedValue([{ id: ids.reminderId, ...ids, dueAt: now }]);
    const unavailable = vi.fn();
    await dispatchReminders(
      databases,
      { add: vi.fn().mockRejectedValue(new Error('Redis offline')) },
      unavailable,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
  });
  it('falha em uma base não impede processar outra organização', async () => {
    const { databases, resolve } = setup();
    const other = randomUUID();
    databases.organizations = async () => [ids.organizationId, other];
    resolve.mockRejectedValueOnce(new Error('Tenant offline'));
    const unavailable = vi.fn();
    await dispatchReminders(databases, { add: vi.fn() }, unavailable);
    expect(resolve).toHaveBeenCalledWith(other);
    expect(unavailable).toHaveBeenCalledOnce();
  });
});
