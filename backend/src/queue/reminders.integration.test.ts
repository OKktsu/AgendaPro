import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as AccountsClient } from '@agendapro/accounts-client';
import { QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { signJwt } from '../auth/jwt.js';
import {
  cancelAppointment,
  createAppointment,
  type AppointmentDatabase,
} from '../appointment/appointment.js';
import { LAB_CONFIG, createTenantClient } from '../tenant/multibase-helper.js';
import { readQueueConfig, workerConnection } from './config.js';
import { createReminderDatabases } from './reminder-databases.js';
import {
  createReminderQueue,
  createReminderWorker,
  dispatchReminders,
  processReminder,
  REMINDER_QUEUE,
} from './reminders.js';

describe.skipIf(process.env.REMINDER_INTEGRATION !== '1')(
  'lembretes: PostgreSQL + Redis reais',
  () => {
    const clients = [
      createTenantClient(LAB_CONFIG.tenantAUrl),
      createTenantClient(LAB_CONFIG.tenantBUrl),
    ];
    const accounts = new AccountsClient({ datasources: { db: { url: LAB_CONFIG.accountsUrl } } });
    const config = readQueueConfig();
    const queue = createReminderQueue(config);
    const events = new QueueEvents(REMINDER_QUEUE, {
      prefix: config.prefix,
      connection: workerConnection(config),
    });
    const databases = createReminderDatabases({
      DATABASE_MODE: 'dedicated',
      ACCOUNTS_DATABASE_URL: LAB_CONFIG.accountsUrl,
      TENANT_DATABASE_URLS: JSON.stringify({
        REMINDER_A: LAB_CONFIG.tenantAUrl,
        REMINDER_B: LAB_CONFIG.tenantBUrl,
      }),
    });
    const fixtures: Array<{
      organizationId: string;
      customerId: string;
      professionalId: string;
      serviceId: string;
    }> = [];
    type Outbox = {
      id: string;
      organizationId: string;
      appointmentId: string;
      status: string;
      dueAt: Date;
      processedAt: Date | null;
    };
    const rows = (index: number, appointmentId: string) =>
      clients[index].$queryRaw<
        Outbox[]
      >`SELECT * FROM "ReminderOutbox" WHERE "appointmentId" = ${appointmentId}::uuid`;
    const dataFor = (r: Outbox) => ({
      organizationId: r.organizationId,
      appointmentId: r.appointmentId,
      reminderId: r.id,
    });
    const future = (hours: number) => {
      const date = new Date(Date.now() + hours * 3600000);
      date.setSeconds(0, 0);
      if (date.getUTCHours() === 2 && date.getUTCMinutes() > 50) date.setUTCMinutes(0);
      return date;
    };
    async function reserve(index = 0, hours = 48) {
      // Cada reserva recebe um profissional próprio, evitando conflitos entre cenários.
      const fixture = fixtures[index];
      const professional = await clients[index].professional.create({
        data: { organizationId: fixture.organizationId, name: 'Profissional teste' },
      });
      await clients[index].professionalService.create({
        data: { professionalId: professional.id, serviceId: fixture.serviceId },
      });
      await clients[index].professionalWorkSchedule.createMany({
        data: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map(
          (weekday) => ({
            professionalId: professional.id,
            weekday: weekday as 'MONDAY',
            startTime: '00:00',
            endTime: '23:59',
          }),
        ),
      });
      // Evitar atravessar meia-noite em qualquer momento de execução do teste.
      const startsAt = future(hours);
      return createAppointment(
        {
          customerId: fixture.customerId,
          professionalId: professional.id,
          serviceId: fixture.serviceId,
          startsAt: startsAt.toISOString(),
        },
        fixture.organizationId,
        clients[index],
      );
    }
    beforeAll(async () => {
      await queue.waitUntilReady();
      await events.waitUntilReady();
      for (const [i, db] of clients.entries()) {
        const organization = await db.organization.create({ data: { name: `Lembretes ${i}` } });
        await accounts.tenantDirectory.create({
          data: {
            id: organization.id,
            databaseKey: i === 0 ? 'REMINDER_A' : 'REMINDER_B',
            status: 'ACTIVE',
          },
        });
        const customer = await db.customer.create({
          data: { organizationId: organization.id, name: 'Cliente lab', phone: '00000000000' },
        });
        const service = await db.service.create({
          data: {
            organizationId: organization.id,
            name: 'Serviço lab',
            durationMinutes: 1,
            priceInCents: 100,
          },
        });
        fixtures.push({
          organizationId: organization.id,
          customerId: customer.id,
          professionalId: '',
          serviceId: service.id,
        });
      }
    });
    afterAll(async () => {
      await queue.close();
      await events.close();
      await databases.close();
      await Promise.all(clients.map((c) => c.$disconnect()));
      await accounts.$disconnect();
    });

    it('cria reserva e pedido durável juntos e agenda 24h antes', async () => {
      const appointment = await reserve();
      const [row] = await rows(0, appointment.id);
      expect(row.status).toBe('PENDING');
      expect(row.dueAt.getTime()).toBe(appointment.startsAt.getTime() - 86400000);
      await dispatchReminders(databases, queue);
      const job = await queue.getJob(row.id);
      expect(job?.data).toEqual(dataFor(row));
      expect(await job!.getState()).toBe('delayed');
      expect((await rows(0, appointment.id))[0].status).toBe('QUEUED');
    });

    it('rollback da reserva se a gravação do pedido falhar', async () => {
      const valid = await reserve();
      const fixture = fixtures[0];
      const db: AppointmentDatabase = {
        customer: clients[0].customer,
        professional: clients[0].professional,
        service: clients[0].service,
        professionalService: clients[0].professionalService,
        professionalWorkSchedule: clients[0].professionalWorkSchedule,
        appointment: clients[0].appointment,
        $executeRaw: clients[0].$executeRaw.bind(clients[0]),
        $transaction: (fn) =>
          clients[0].$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(target, key) {
                  if (key === '$executeRaw')
                    return async () => {
                      throw new Error('Falha outbox simulada');
                    };
                  return Reflect.get(target, key);
                },
              }),
            ),
          ),
      };
      const before = await clients[0].appointment.count();
      await expect(
        createAppointment(
          {
            customerId: valid.customerId,
            professionalId: valid.professionalId,
            serviceId: valid.serviceId,
            startsAt: future(72).toISOString(),
          },
          fixture.organizationId,
          db,
        ),
      ).rejects.toThrow('Falha outbox simulada');
      expect(await clients[0].appointment.count()).toBe(before);
    });

    it('pedido permanece PENDING se Redis falhar e uma nova tentativa o publica', async () => {
      const appointment = await reserve();
      const [row] = await rows(0, appointment.id);
      await dispatchReminders(
        databases,
        {
          add: async () => {
            throw new Error('Redis offline');
          },
        },
        () => {},
      );
      expect((await rows(0, appointment.id))[0].status).toBe('PENDING');
      await dispatchReminders(databases, queue);
      expect(await queue.getJob(row.id)).toBeDefined();
    });

    it('republicar depois de falha na confirmação não duplica o trabalho', async () => {
      const appointment = await reserve();
      const [row] = await rows(0, appointment.id);
      // Simula crash depois de Redis aceitar e antes de PostgreSQL confirmar.
      await queue.add('reminder', dataFor(row), { jobId: row.id, delay: 86400000 });
      const before = await queue.getDelayedCount();
      await dispatchReminders(databases, queue);
      expect(await queue.getDelayedCount()).toBe(before);
      expect((await rows(0, appointment.id))[0].status).toBe('QUEUED');
    });

    it('cancelamento durável impede processamento de um trabalho já na fila', async () => {
      const appointment = await reserve();
      const [row] = await rows(0, appointment.id);
      await dispatchReminders(databases, queue);
      await cancelAppointment(appointment.id, row.organizationId, clients[0]);
      expect(await processReminder({ name: 'reminder', data: dataFor(row) }, databases)).toBe(
        'skipped',
      );
      const [cancelled] = await rows(0, appointment.id);
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.processedAt).toBeNull();
    });

    it('ignora reserva passada e trabalho antecipado', async () => {
      const appointment = await reserve();
      const [row] = await rows(0, appointment.id);
      await expect(
        processReminder({ name: 'reminder', data: dataFor(row) }, databases),
      ).rejects.toThrow('Lembrete ainda não está no horário');
      expect((await rows(0, appointment.id))[0].status).toBe('PENDING');
      await clients[0].appointment.update({
        where: { id: appointment.id },
        data: { startsAt: new Date(Date.now() - 120000), endsAt: new Date(Date.now() - 60000) },
      });
      expect(await processReminder({ name: 'reminder', data: dataFor(row) }, databases)).toBe(
        'skipped',
      );
      expect((await rows(0, appointment.id))[0].status).toBe('SKIPPED');
    });

    it('processamento concorrente e repetido marca PROCESSED uma única vez', async () => {
      const appointment = await reserve(0, 2);
      const [row] = await rows(0, appointment.id);
      const results = await Promise.all([
        processReminder({ name: 'reminder', data: dataFor(row) }, databases),
        processReminder({ name: 'reminder', data: dataFor(row) }, databases),
      ]);
      expect(results.sort()).toEqual(['processed', 'skipped']);
      const [first] = await rows(0, appointment.id);
      await dispatchReminders(databases, queue);
      await processReminder({ name: 'reminder', data: dataFor(row) }, databases);
      expect((await rows(0, appointment.id))[0].processedAt).toEqual(first.processedAt);
      expect(first.status).toBe('PROCESSED');
    });

    it('organização B não processa o lembrete de A, mesmo com seu ID', async () => {
      const appointment = await reserve(0, 2);
      const [row] = await rows(0, appointment.id);
      expect(
        await processReminder(
          {
            name: 'reminder',
            data: { ...dataFor(row), organizationId: fixtures[1].organizationId },
          },
          databases,
        ),
      ).toBe('skipped');
      expect((await rows(0, appointment.id))[0].status).toBe('PENDING');
      expect(await rows(1, appointment.id)).toEqual([]);
    });

    it('worker real consome a fila e simula um lembrete sem envio externo', async () => {
      const appointment = await reserve(1, 2);
      const [row] = await rows(1, appointment.id);
      await dispatchReminders(databases, queue);
      const job = await queue.getJob(row.id);
      const completed = job!.waitUntilFinished(events, 10000);
      const worker = createReminderWorker(config, databases);
      try {
        expect(await completed).toBe('processed');
      } finally {
        await worker.close();
      }
      expect((await rows(1, appointment.id))[0].status).toBe('PROCESSED');
    }, 15000);

    it('tenant suspenso não processa nem cai na base compartilhada', async () => {
      const appointment = await reserve(1, 2);
      const [row] = await rows(1, appointment.id);
      await accounts.tenantDirectory.update({
        where: { id: row.organizationId },
        data: { status: 'SUSPENDED' },
      });
      try {
        await expect(
          processReminder({ name: 'reminder', data: dataFor(row) }, databases),
        ).rejects.toThrow('Base do lembrete indisponível');
      } finally {
        await accounts.tenantDirectory.update({
          where: { id: row.organizationId },
          data: { status: 'ACTIVE' },
        });
      }
      expect((await rows(1, appointment.id))[0].status).toBe('PENDING');
    });

    it('API cria reserva sem abrir conexão Redis', async () => {
      const seeded = await reserve(0, 48);
      const app = buildApp({ appointmentDatabase: clients[0], jwtSecret: 'reminder-lab' });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/appointments',
          headers: {
            authorization: `Bearer ${signJwt({ id: randomUUID(), name: 'Lab', email: 'lab@example.test', organizationId: fixtures[0].organizationId, role: 'OWNER' }, 'reminder-lab')}`,
          },
          payload: {
            customerId: seeded.customerId,
            professionalId: seeded.professionalId,
            serviceId: seeded.serviceId,
            startsAt: future(96).toISOString(),
          },
        });
        expect(response.statusCode, response.body).toBe(201);
        expect((await rows(0, response.json().appointment.id))[0].status).toBe('PENDING');
      } finally {
        await app.close();
      }
    });

    it('worker devolve trabalho antecipado ao delayed sem consumir tentativa de falha', async () => {
      const appointment = await reserve();
      const [row] = await rows(0, appointment.id);
      const job = await queue.add('reminder', dataFor(row), { jobId: row.id });
      const worker = createReminderWorker(config, databases);
      try {
        await vi.waitFor(async () => expect(await job.getState()).toBe('delayed'), {
          timeout: 5000,
          interval: 50,
        });
        expect((await queue.getJob(row.id))!.attemptsMade).toBe(0);
        expect((await rows(0, appointment.id))[0].status).toBe('PENDING');
        expect((await rows(0, appointment.id))[0].processedAt).toBeNull();
      } finally {
        await worker.close();
      }
    }, 10000);

    it('modo compartilhado cria e processa lembrete, preservando o filtro de organização', async () => {
      const sharedUrl = `postgresql://lab_admin:lab_admin_only@${LAB_CONFIG.host}:${LAB_CONFIG.port}/lab_admin`;
      const db = new PrismaClient({ datasources: { db: { url: sharedUrl } } });
      const shared = createReminderDatabases({ DATABASE_URL: sharedUrl });
      try {
        const org = await db.organization.create({ data: { name: 'Shared lab' } });
        expect(await shared.organizations()).toContain(org.id);
        expect(await shared.resolve(org.id)).not.toBeNull();
        const customer = await db.customer.create({
          data: { organizationId: org.id, name: 'Shared cliente', phone: '00000000000' },
        });
        const professional = await db.professional.create({
          data: { organizationId: org.id, name: 'Shared profissional' },
        });
        const service = await db.service.create({
          data: {
            organizationId: org.id,
            name: 'Shared serviço',
            durationMinutes: 1,
            priceInCents: 100,
          },
        });
        await db.professionalService.create({
          data: { professionalId: professional.id, serviceId: service.id },
        });
        await db.professionalWorkSchedule.createMany({
          data: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map(
            (weekday) => ({
              professionalId: professional.id,
              weekday: weekday as 'MONDAY',
              startTime: '00:00',
              endTime: '23:59',
            }),
          ),
        });
        const appointment = await createAppointment(
          {
            customerId: customer.id,
            professionalId: professional.id,
            serviceId: service.id,
            startsAt: future(2).toISOString(),
          },
          org.id,
          db,
        );
        const [row] = await db.$queryRaw<
          Outbox[]
        >`SELECT * FROM "ReminderOutbox" WHERE "appointmentId" = ${appointment.id}::uuid`;
        expect(
          await processReminder(
            { name: 'reminder', data: { ...dataFor(row), organizationId: randomUUID() } },
            shared,
          ),
        ).toBe('skipped');
        expect(await processReminder({ name: 'reminder', data: dataFor(row) }, shared)).toBe(
          'processed',
        );
        expect(
          await processReminder(
            {
              name: 'reminder',
              data: {
                organizationId: org.id,
                appointmentId: randomUUID(),
                reminderId: randomUUID(),
              },
            },
            shared,
          ),
        ).toBe('skipped');
      } finally {
        await shared.close();
        await db.$disconnect();
      }
    });
  },
);
