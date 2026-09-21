import { describe, expect, it } from 'vitest';

import { hashPassword, registerBodySchema } from './register.js';

describe('cadastro inicial', () => {
  const validInput = {
    organizationName: 'Barbearia Central',
    name: 'Marcelo Luan',
    email: 'marcelo@example.com',
    password: 'senha-segura-123',
  };

  it('accepts valid registration data', () => {
    expect(registerBodySchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects an invalid email address', () => {
    expect(registerBodySchema.safeParse({ ...validInput, email: 'invalido' }).success).toBe(false);
  });

  it('rejects passwords shorter than eight characters', () => {
    expect(registerBodySchema.safeParse({ ...validInput, password: 'curta' }).success).toBe(false);
  });

  it('creates a scrypt password hash without storing the password in plain text', async () => {
    const passwordHash = await hashPassword(validInput.password);

    expect(passwordHash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(passwordHash).not.toContain(validInput.password);
  });

  it('creates different hashes for the same password because each hash has its own salt', async () => {
    const firstHash = await hashPassword(validInput.password);
    const secondHash = await hashPassword(validInput.password);

    expect(firstHash).not.toBe(secondHash);
  });
});
