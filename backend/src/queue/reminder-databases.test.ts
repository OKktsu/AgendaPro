import { describe, expect, it } from 'vitest';
import { createReminderDatabases } from './reminder-databases.js';

describe('configuração das bases do worker', () => {
  it('modo compartilhado exige uma conexão explícita', () => {
    expect(() => createReminderDatabases({})).toThrow('Worker exige DATABASE_URL');
  });
  it.each([
    { DATABASE_MODE: 'dedicated' },
    {
      DATABASE_MODE: 'dedicated',
      ACCOUNTS_DATABASE_URL: 'postgresql://user:secret@localhost/accounts',
      TENANT_DATABASE_URLS: 'invalid-json',
    },
    {
      DATABASE_MODE: 'dedicated',
      ACCOUNTS_DATABASE_URL: 'postgresql://user:secret@localhost/accounts',
      TENANT_DATABASE_URLS: JSON.stringify({
        SAME: 'postgresql://other:secret@localhost:5432/accounts',
      }),
    },
    {
      DATABASE_MODE: 'dedicated',
      ACCOUNTS_DATABASE_URL: 'postgresql://user:secret@localhost/accounts',
      TENANT_DATABASE_URLS: JSON.stringify({
        A: 'postgresql://user:secret@localhost/a',
        B: 'postgresql://other:secret@localhost:5432/a',
      }),
    },
  ])('configuração inválida do dedicado falha sem fallback nem exposição de senhas', (env) => {
    expect(() => createReminderDatabases(env)).toThrow('Configuração de bases do worker inválida.');
    try {
      createReminderDatabases(env);
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
  it('encerrar o runtime impede novas resoluções e consultas', async () => {
    const db = createReminderDatabases({
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:9/unused',
    });
    await db.close();
    await expect(db.resolve('organization')).rejects.toThrow('Worker encerrado');
    await expect(db.organizations()).rejects.toThrow('Worker encerrado');
  });
});
