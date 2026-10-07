import { describe, expect, it } from 'vitest';
import { signSelectionToken, verifySelectionToken, selectOrganizationSchema } from './selection.js';
import { signJwt, verifyJwt } from '../auth/jwt.js';
import { buildApp } from '../app.js';
import { InvalidCredentialsError } from '../auth/login.js';
import { TenantSelectionRequiredError } from './auth.js';

const id = '11111111-1111-4111-8111-111111111111';
const secret = 'selection-test-secret';
const now = 1800000000000;
const user = {
  id,
  name: 'Marcelo',
  email: 'marcelo@example.test',
  role: 'OWNER' as const,
  organizationId: id,
};
describe('comprovante temporário de seleção de empresa', () => {
  it('retorna somente a identidade verificada', () => {
    expect(verifySelectionToken(signSelectionToken(id, secret, now), secret, now)).toBe(id);
  });
  it('expira após cinco minutos inclusive no limite', () => {
    const token = signSelectionToken(id, secret, now);
    expect(verifySelectionToken(token, secret, now + 299000)).toBe(id);
    expect(() => verifySelectionToken(token, secret, now + 300000)).toThrow(
      InvalidCredentialsError,
    );
  });
  it('nega segredo diferente', () => {
    expect(() => verifySelectionToken(signSelectionToken(id, secret, now), 'other', now)).toThrow();
  });
  it('nega conteúdo adulterado e formatos inválidos', () => {
    const token = signSelectionToken(id, secret, now);
    for (const invalid of [
      '',
      token + '.extra',
      token.replace('selection.', 'other.'),
      token.replace(/.$/, '!'),
    ])
      expect(() => verifySelectionToken(invalid, secret, now)).toThrow();
  });
  it('não aceita um JWT operacional como comprovante', () => {
    expect(() => verifySelectionToken(signJwt(user, secret), secret)).toThrow();
  });
  it('o middleware operacional não aceita o comprovante de seleção', async () => {
    const token = signSelectionToken(id, secret);
    expect(() => verifyJwt(token, secret)).toThrow();
    const app = buildApp({ jwtSecret: secret });
    try {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/auth/me',
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('valida UUID e rejeita campos extras na escolha', () => {
    expect(
      selectOrganizationSchema.safeParse({ selectionToken: 'token', organizationId: id }).success,
    ).toBe(true);
    expect(
      selectOrganizationSchema.safeParse({ selectionToken: 'token', organizationId: 'bad' })
        .success,
    ).toBe(false);
    expect(
      selectOrganizationSchema.safeParse({
        selectionToken: 'token',
        organizationId: id,
        accountId: id,
      }).success,
    ).toBe(false);
  });
  it('login por senha e Google expõe a escolha sem emitir sessão', async () => {
    const selection = {
      status: 'organization_selection_required' as const,
      selectionToken: 'temporary',
      organizations: [{ id, name: 'Empresa', role: 'OWNER' as const }],
    };
    const reject = async () => {
      throw new TenantSelectionRequiredError(selection);
    };
    const app = buildApp({
      loginUser: reject,
      loginWithGoogle: reject,
      verifyGoogleCredential: async () => ({ subject: 'google', email: user.email }),
    });
    try {
      for (const [url, payload] of [
        ['/auth/login', { email: user.email, password: 'password123' }],
        ['/auth/google', { credential: 'google-token' }],
      ] as const) {
        const response = await app.inject({ method: 'POST', url, payload });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(selection);
        expect(response.json().token).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
  it('escolha inválida retorna erro genérico sem detalhes internos', async () => {
    const app = buildApp({
      selectOrganization: async () => {
        throw new InvalidCredentialsError();
      },
    });
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/select-organization',
            payload: { selectionToken: 'bad', organizationId: id },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url: '/auth/select-organization', payload: {} }))
          .statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
