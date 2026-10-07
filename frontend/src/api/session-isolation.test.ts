import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setToken, clearToken, getToken } from './client.js';
import { authApi } from './index.js';

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

describe('seleção e isolamento das respostas por sessão', () => {
  it('login com várias empresas não é convertido em sessão operacional', async () => {
    const selection = {
      status: 'organization_selection_required',
      selectionToken: 'temporary',
      organizations: [{ id: 'a', name: 'Empresa A', role: 'OWNER' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(selection)));
    expect(await authApi.login({ email: 'test@example.test', password: 'test-password' })).toEqual(
      selection,
    );
    expect(getToken()).toBeNull();
  });
  it('envia comprovante e empresa escolhida sem enviar papel ou identidade', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ user: {}, token: 'operational' }));
    vi.stubGlobal('fetch', fetch);
    await authApi.selectOrganization('temporary', 'b');
    expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/select-organization$/);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      selectionToken: 'temporary',
      organizationId: 'b',
    });
    expect(getToken()).toBeNull();
  });
  it('lista empresas com a sessão atual, não com parâmetros arbitrários', async () => {
    setToken('company-a');
    const fetch = vi.fn().mockResolvedValue(json({ organizations: [] }));
    vi.stubGlobal('fetch', fetch);
    await authApi.listOrganizations();
    expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/organizations$/);
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer company-a');
  });
  it('descarta resposta atrasada da empresa anterior após troca', async () => {
    setToken('company-a');
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = apiFetch('/customers');
    setToken('company-b');
    resolve(json({ customers: ['customer-a'] }));
    await expect(request).rejects.toMatchObject({ status: 409 });
    expect(getToken()).toBe('company-b');
  });
  it('descarta resposta após logout mesmo sem uma nova empresa', async () => {
    setToken('company-a');
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = apiFetch('/appointments');
    clearToken();
    resolve(new Response(null, { status: 204 }));
    await expect(request).rejects.toMatchObject({ status: 409 });
  });
  it('também descarta quando a sessão muda durante a leitura do JSON', async () => {
    setToken('company-a');
    let resolve!: (value: unknown) => void;
    const response = json({});
    response.json = () =>
      new Promise((done) => {
        resolve = done;
      });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const request = apiFetch('/customers');
    await Promise.resolve();
    setToken('company-b');
    resolve({ customers: ['old'] });
    await expect(request).rejects.toMatchObject({ status: 409 });
  });
});
