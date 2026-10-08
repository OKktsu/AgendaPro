import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAppointment } from '../appointment/appointment.js';
import { buildApp } from '../app.js';
import {
  LAB_CONFIG,
  cleanLabDatabases,
  createAccountsClient,
  createTenantClient,
} from '../tenant/multibase-helper.js';
import { readQueueConfig } from './config.js';
import { createReminderQueue } from './reminders.js';
import { createProbeQueue } from './probe.js';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(backend, '..');
type Running = {
  child: ChildProcess;
  output: string;
  stop(): Promise<{ code: number | null; signal: string | null }>;
};

describe.skipIf(process.env.REMINDER_INTEGRATION !== '1')(
  'dispatcher e consumidores em processos reais',
  () => {
    const clients = [
      createTenantClient(LAB_CONFIG.tenantAUrl),
      createTenantClient(LAB_CONFIG.tenantBUrl),
    ];
    const accounts = createAccountsClient();
    const config = { ...readQueueConfig(), prefix: `${readQueueConfig().prefix}-processes` };
    const queue = createReminderQueue(config);
    const children = new Set<Running>();
    const fixtures: Array<{ organizationId: string; customerId: string; serviceId: string }> = [];
    type Row = {
      id: string;
      organizationId: string;
      appointmentId: string;
      status: string;
      processedAt: Date | null;
    };
    const rowFor = async (index: number, appointmentId: string) =>
      (
        await clients[index].$queryRaw<
          Row[]
        >`SELECT * FROM "ReminderOutbox" WHERE "appointmentId" = ${appointmentId}::uuid`
      )[0];
    const dataFor = (row: Row) => ({
      organizationId: row.organizationId,
      appointmentId: row.appointmentId,
      reminderId: row.id,
    });

    async function launch(
      role: 'dispatcher' | 'consumer' | 'probe',
      compiled = false,
      extra: NodeJS.ProcessEnv = {},
    ) {
      const file =
        role === 'dispatcher' ? 'dispatcher' : role === 'consumer' ? 'worker' : 'probe-worker';
      const child = fork(path.join(backend, compiled ? `dist/${file}.js` : `src/${file}.ts`), {
        cwd: backend,
        execArgv: compiled ? [] : ['--import', 'tsx'],
        env: {
          ...process.env,
          DATABASE_MODE: 'dedicated',
          ACCOUNTS_DATABASE_URL: LAB_CONFIG.accountsUrl,
          TENANT_DATABASE_URLS: JSON.stringify({
            PROCESS_A: LAB_CONFIG.tenantAUrl,
            PROCESS_B: LAB_CONFIG.tenantBUrl,
          }),
          REDIS_URL: process.env.REDIS_URL,
          QUEUE_PREFIX: config.prefix,
          REMINDER_POLL_INTERVAL_MS: '1000',
          ...extra,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const ended = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
        child.once('exit', (code, signal) => resolve({ code, signal })),
      );
      let stopping: Promise<{ code: number | null; signal: string | null }> | undefined;
      const running: Running = {
        child,
        output: '',
        stop() {
          if (stopping) return stopping;
          stopping = (async () => {
            if (child.exitCode === null && child.signalCode === null && child.connected)
              child.send({ type: 'shutdown' }, () => {});
            const deadline = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            }, 15000);
            try {
              return await ended;
            } finally {
              clearTimeout(deadline);
              children.delete(running);
            }
          })();
          return stopping;
        },
      };
      children.add(running);
      child.stdout?.on('data', (chunk) => {
        running.output = (running.output + chunk.toString()).slice(-20000);
      });
      child.stderr?.on('data', (chunk) => {
        running.output = (running.output + chunk.toString()).slice(-20000);
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Processo ${role} não iniciou a tempo.`));
        }, 10000);
        const onMessage = (message: unknown) => {
          if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            'role' in message &&
            message.role === role &&
            message.type === (role === 'dispatcher' ? 'started' : 'ready')
          ) {
            cleanup();
            resolve();
          }
        };
        const onExit = () => {
          cleanup();
          reject(new Error(`Processo ${role} encerrou antes de iniciar: ${running.output}`));
        };
        const onError = () => {
          cleanup();
          reject(new Error(`Falha ao iniciar ${role}.`));
        };
        function cleanup() {
          clearTimeout(timer);
          child.off('message', onMessage);
          child.off('exit', onExit);
          child.off('error', onError);
        }
        child.on('message', onMessage);
        child.once('exit', onExit);
        child.once('error', onError);
      });
      return running;
    }

    async function reserve(index = 0) {
      const db = clients[index];
      const fixture = fixtures[index];
      const professional = await db.professional.create({
        data: { organizationId: fixture.organizationId, name: 'Processo lab' },
      });
      await db.professionalService.create({
        data: { professionalId: professional.id, serviceId: fixture.serviceId },
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
      const startsAt = new Date(Date.now() + 7200000);
      startsAt.setSeconds(0, 0);
      if (startsAt.getUTCHours() === 2 && startsAt.getUTCMinutes() > 50) startsAt.setUTCMinutes(0);
      const appointment = await createAppointment(
        {
          customerId: fixture.customerId,
          professionalId: professional.id,
          serviceId: fixture.serviceId,
          startsAt: startsAt.toISOString(),
        },
        fixture.organizationId,
        db,
      );
      return rowFor(index, appointment.id);
    }
    const waitStatus = async (row: Row, status: string, index = 0) =>
      vi.waitFor(async () => expect((await rowFor(index, row.appointmentId)).status).toBe(status), {
        timeout: 15000,
        interval: 100,
      });
    beforeAll(async () => {
      // Apenas bases descartáveis do runner; a suíte anterior já terminou neste ponto.
      await cleanLabDatabases(accounts, clients[0], clients[1]);
      await queue.waitUntilReady();
      for (const [i, db] of clients.entries()) {
        const organization = await db.organization.create({ data: { name: `Processos ${i}` } });
        await accounts.tenantDirectory.create({
          data: {
            id: organization.id,
            databaseKey: i === 0 ? 'PROCESS_A' : 'PROCESS_B',
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
          serviceId: service.id,
        });
      }
    });
    afterEach(async () => {
      await Promise.all(
        [...children].map(async (running) => expect((await running.stop()).code).toBe(0)),
      );
    }, 30000);
    afterAll(async () => {
      await Promise.all([...children].map((running) => running.stop()));
      await queue.close();
      await accounts.$disconnect();
      await Promise.all(clients.map((client) => client.$disconnect()));
    });

    it('dispatcher sozinho publica e não consome o trabalho', async () => {
      const row = await reserve();
      const dispatcher = await launch('dispatcher');
      await waitStatus(row, 'QUEUED');
      expect(await (await queue.getJob(row.id))!.getState()).toBe('waiting');
      expect((await rowFor(0, row.appointmentId)).processedAt).toBeNull();
      expect((await dispatcher.stop()).code).toBe(0);
      expect(await (await queue.getJob(row.id))!.getState()).toBe('waiting');
    }, 25000);

    it('consumidor sozinho não publica outbox nem consome a fila probe', async () => {
      const unpublished = await reserve();
      const published = await reserve(1);
      await queue.add('reminder', dataFor(published), { jobId: published.id });
      const probes = createProbeQueue(config);
      try {
        await probes.waitUntilReady();
        const id = randomUUID();
        const probe = await probes.add('probe', { runId: id }, { jobId: id });
        await launch('consumer', false, { REMINDER_POLL_INTERVAL_MS: 'invalid' });
        await waitStatus(published, 'PROCESSED', 1);
        expect((await rowFor(0, unpublished.appointmentId)).status).toBe('PENDING');
        expect(await queue.getJob(unpublished.id)).toBeUndefined();
        expect(await probe.getState()).toBe('waiting');
      } finally {
        await probes.close();
      }
    }, 25000);

    it('dois consumidores concorrentes não repetem o efeito, mesmo com jobs diferentes', async () => {
      const row = await reserve();
      const a = await launch('consumer');
      const b = await launch('consumer', true);
      const original = await queue.add('reminder', dataFor(row), { jobId: row.id });
      const duplicate = await queue.add('reminder', dataFor(row), { jobId: randomUUID() });
      await waitStatus(row, 'PROCESSED');
      await vi.waitFor(
        async () => {
          expect(await original.getState()).toBe('completed');
          expect(await duplicate.getState()).toBe('completed');
          expect(
            (a.output + b.output).split(`Lembrete ${row.id}: processed`).length -
              1 +
              (a.output + b.output).split(`Lembrete ${duplicate.id}: processed`).length -
              1,
          ).toBe(1);
        },
        { timeout: 10000, interval: 100 },
      );
      const first = await rowFor(0, row.appointmentId);
      await original.remove();
      const replay = await queue.add('reminder', dataFor(row), { jobId: row.id });
      await vi.waitFor(async () => expect(await replay.getState()).toBe('completed'), {
        timeout: 10000,
        interval: 100,
      });
      expect((await rowFor(0, row.appointmentId)).processedAt).toEqual(first.processedAt);
    }, 30000);

    it('dois dispatchers publicam apenas um job por ID estável', async () => {
      const row = await reserve();
      await launch('dispatcher');
      await launch('dispatcher', true);
      await waitStatus(row, 'QUEUED');
      const jobs = await queue.getJobs(['waiting', 'delayed']);
      expect(jobs.filter((job) => job.data.reminderId === row.id)).toHaveLength(1);
      expect((await rowFor(0, row.appointmentId)).processedAt).toBeNull();
    }, 25000);

    it('reiniciar cada papel preserva o outro processo e a API', async () => {
      const app = buildApp();
      try {
        const consumer = await launch('consumer');
        const consumerPid = consumer.child.pid;
        const first = await reserve();
        const dispatcher = await launch('dispatcher');
        await waitStatus(first, 'PROCESSED');
        expect((await dispatcher.stop()).code).toBe(0);
        const second = await reserve();
        expect((await rowFor(0, second.appointmentId)).status).toBe('PENDING');
        expect(consumer.child.exitCode).toBeNull();
        expect(consumer.child.pid).toBe(consumerPid);
        const newDispatcher = await launch('dispatcher', true);
        const dispatcherPid = newDispatcher.child.pid;
        await waitStatus(second, 'PROCESSED');
        expect((await consumer.stop()).code).toBe(0);
        const third = await reserve();
        await waitStatus(third, 'QUEUED');
        expect(newDispatcher.child.exitCode).toBeNull();
        expect(newDispatcher.child.pid).toBe(dispatcherPid);
        expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
        await launch('consumer', true);
        await waitStatus(third, 'PROCESSED');
        expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      } finally {
        await app.close();
      }
    }, 45000);

    it('probe compilado funciona sem banco e não processa lembretes', async () => {
      const row = await reserve();
      const reminder = await queue.add('reminder', dataFor(row), { jobId: row.id });
      const probes = createProbeQueue(config);
      try {
        await probes.waitUntilReady();
        const id = randomUUID();
        const job = await probes.add('probe', { runId: id }, { jobId: id });
        await launch('probe', true, {
          DATABASE_URL: '',
          ACCOUNTS_DATABASE_URL: '',
          TENANT_DATABASE_URLS: 'invalid',
          REMINDER_POLL_INTERVAL_MS: 'invalid',
        });
        await vi.waitFor(async () => expect(await job.getState()).toBe('completed'), {
          timeout: 10000,
          interval: 100,
        });
        expect(await reminder.getState()).toBe('waiting');
        expect((await rowFor(0, row.appointmentId)).processedAt).toBeNull();
      } finally {
        await probes.close();
      }
    }, 25000);

    it('dispatcher recupera pedidos após queda real do Redis, sem reiniciar', async () => {
      const project = process.env.REMINDER_TEST_PROJECT ?? '';
      if (!/^agendapro-reminder-test-[a-f0-9]{8}$/.test(project))
        throw new Error('Projeto descartável obrigatório.');
      const compose = [
        'compose',
        '-p',
        project,
        '-f',
        path.join(root, 'docker-compose.multibase-test.yml'),
        '-f',
        path.join(root, 'docker-compose.queue-test.yml'),
      ];
      const dispatcher = await launch('dispatcher');
      const pid = dispatcher.child.pid;
      let row!: Row;
      try {
        execFileSync('docker', [...compose, 'stop', 'redis-test'], {
          env: process.env,
          stdio: 'pipe',
          timeout: 30000,
        });
        row = await reserve();
        await vi.waitFor(() => expect(dispatcher.output).toContain('base ou fila indisponível'), {
          timeout: 10000,
          interval: 100,
        });
        expect((await rowFor(0, row.appointmentId)).status).toBe('PENDING');
      } finally {
        execFileSync('docker', [...compose, 'up', '-d', '--wait', 'redis-test'], {
          env: process.env,
          stdio: 'pipe',
          timeout: 30000,
        });
      }
      await waitStatus(row, 'QUEUED');
      expect(dispatcher.child.pid).toBe(pid);
      expect(dispatcher.child.exitCode).toBeNull();
      await launch('consumer');
      await waitStatus(row, 'PROCESSED');
    }, 60000);
  },
);
