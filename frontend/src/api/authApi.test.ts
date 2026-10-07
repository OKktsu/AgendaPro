import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi } from './index.js';

afterEach(() => vi.unstubAllGlobals());

describe('Google onboarding API', () => {
  it('returns onboarding profile instead of assuming a session exists', async () => {
    const result = {
      status: 'registration_required',
      profile: { email: 'person@example.com', name: 'Person' },
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }),
        ),
    );
    await expect(authApi.loginWithGoogle('credential')).resolves.toEqual(result);
  });

  it('sends the Google credential for server verification when completing registration', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const input = {
      name: 'Person',
      email: 'person@example.com',
      password: 'secure-password',
      organizationName: 'Company',
      googleCredential: 'credential',
    };
    await authApi.register(input);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
    expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/register$/);
  });
});
