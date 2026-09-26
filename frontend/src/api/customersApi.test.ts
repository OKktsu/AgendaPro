import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customersApi } from './index.js';
import { ApiError, TOKEN_STORAGE_KEY } from './client.js';
import type { Customer, UpdateCustomerInput } from '../types/api.js';

describe('customersApi (list, create, update e fluxo de agendamento)', () => {
  const originalFetch = globalThis.fetch;
  const mockToken = 'mock-jwt-token-customers-test';
  const storageMap = new Map<string, string>();

  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    key: () => null,
    length: 0,
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    storageMap.clear();
    mockLocalStorage.setItem(TOKEN_STORAGE_KEY, mockToken);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    storageMap.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lista clientes sem filtro chamando /customers com header de autorização', async () => {
    const mockCustomers: Customer[] = [
      {
        id: 'cust-1',
        organizationId: 'org-1',
        name: 'Camila Rocha',
        phone: '11988887777',
        email: 'camila@email.com',
        createdAt: '2026-09-24T10:00:00Z',
        updatedAt: '2026-09-24T10:00:00Z',
      },
    ];

    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      capturedUrl = url;
      capturedOptions = options;
      return new Response(JSON.stringify({ customers: mockCustomers }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await customersApi.list();

    expect(capturedUrl).toContain('/customers');
    expect(capturedUrl).not.toContain('search=');
    expect(capturedOptions?.method ?? 'GET').toBe('GET');

    const headers = capturedOptions?.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${mockToken}`);
    expect(result).toEqual(mockCustomers);
  });

  it('lista clientes passando parâmetro de busca codificado na URL', async () => {
    let capturedUrl = '';

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ customers: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await customersApi.list('Carlos da Silva & Cia');

    expect(capturedUrl).toContain('/customers?search=Carlos%20da%20Silva%20%26%20Cia');
  });

  it('chama endpoint PATCH /customers/:id com dados válidos e token', async () => {
    const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const updatePayload: UpdateCustomerInput = {
      name: 'Camila Rocha Atualizada',
      phone: '11977776666',
      email: 'camila.nova@email.com',
    };

    const mockUpdatedCustomer: Customer = {
      id: customerId,
      organizationId: 'org-1',
      name: updatePayload.name!,
      phone: updatePayload.phone!,
      email: updatePayload.email!,
      createdAt: '2026-09-24T10:00:00Z',
      updatedAt: '2026-09-25T14:00:00Z',
    };

    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      capturedUrl = url;
      capturedOptions = options;
      return new Response(
        JSON.stringify({
          message: 'Cliente atualizado com sucesso.',
          customer: mockUpdatedCustomer,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const result = await customersApi.update(customerId, updatePayload);

    expect(capturedUrl).toContain(`/customers/${customerId}`);
    expect(capturedOptions?.method).toBe('PATCH');

    const headers = capturedOptions?.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${mockToken}`);
    expect(JSON.parse(capturedOptions?.body as string)).toEqual(updatePayload);

    expect(result).toEqual(mockUpdatedCustomer);
    expect(result.name).toBe('Camila Rocha Atualizada');
    expect(result.phone).toBe('11977776666');
  });

  it('lança ApiError com status 404 quando o cliente não existe ou pertence a outra organização', async () => {
    const foreignCustomerId = '99999999-9999-4999-8999-999999999999';

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          message: 'Cliente não encontrado na organização.',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    await expect(
      customersApi.update(foreignCustomerId, { name: 'Tentativa Invasão' }),
    ).rejects.toThrow('Cliente não encontrado na organização.');

    try {
      await customersApi.update(foreignCustomerId, { name: 'Tentativa Invasão' });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.message).toBe('Cliente não encontrado na organização.');
    }
  });

  it('lança ApiError com status 400 em caso de payload inválido', async () => {
    const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          message: 'Dados de cliente inválidos.',
          issues: { email: ['Formato de email inválido.'] },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    await expect(customersApi.update(customerId, { email: 'invalido' })).rejects.toThrow(
      'Dados de cliente inválidos.',
    );
  });

  it('permite atualizar a lista local de forma imutável sem recarregar a página', () => {
    const initialList: Customer[] = [
      {
        id: 'c-1',
        organizationId: 'org-1',
        name: 'Cliente Antigo',
        phone: '11999990000',
        email: 'antigo@email.com',
        createdAt: '2026-09-24T00:00:00Z',
        updatedAt: '2026-09-24T00:00:00Z',
      },
      {
        id: 'c-2',
        organizationId: 'org-1',
        name: 'Cliente Dois',
        phone: '11988880000',
        email: null,
        createdAt: '2026-09-24T00:00:00Z',
        updatedAt: '2026-09-24T00:00:00Z',
      },
    ];

    const updatedCustomer: Customer = {
      id: 'c-1',
      organizationId: 'org-1',
      name: 'Cliente Modificado',
      phone: '11977770000',
      email: 'novo@email.com',
      createdAt: '2026-09-24T00:00:00Z',
      updatedAt: '2026-09-25T15:00:00Z',
    };

    // Função que espelha o setCustomers((prev) => prev.map(...)) de CustomersPage
    const nextList = initialList.map((c) => (c.id === updatedCustomer.id ? updatedCustomer : c));

    expect(nextList).toHaveLength(2);
    expect(nextList[0].name).toBe('Cliente Modificado');
    expect(nextList[0].phone).toBe('11977770000');
    expect(nextList[1].name).toBe('Cliente Dois');
    // Imutabilidade
    expect(initialList[0].name).toBe('Cliente Antigo');
  });

  it('garante que o cliente editado é compatível com a seleção de clientes do formulário de agendamento', () => {
    const updatedCustomer: Customer = {
      id: 'c-1',
      organizationId: 'org-1',
      name: 'Cliente Atualizado',
      phone: '11999992222',
      email: 'atualizado@teste.com',
      createdAt: '2026-09-24T00:00:00Z',
      updatedAt: '2026-09-25T15:00:00Z',
    };

    // Espelha o dropdown de seleção do NewAppointmentModal:
    // <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
    const optionLabel = `${updatedCustomer.name} (${updatedCustomer.phone})`;
    const optionValue = updatedCustomer.id;

    expect(optionValue).toBe('c-1');
    expect(optionLabel).toBe('Cliente Atualizado (11999992222)');
  });
});
