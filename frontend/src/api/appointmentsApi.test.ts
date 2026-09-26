import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appointmentsApi } from './index.js';
import { ApiError, TOKEN_STORAGE_KEY } from './client.js';
import type { Appointment, Service } from '../types/api.js';

describe('appointmentsApi.cancel e Lógica de Cancelamento', () => {
  const originalFetch = globalThis.fetch;
  const mockToken = 'mock-jwt-token-12345';
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

  it('chama endpoint PATCH /appointments/:id/cancel com token de autenticação', async () => {
    const appointmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const mockCancelledAppointment: Appointment = {
      id: appointmentId,
      organizationId: 'org-123',
      customerId: 'cust-123',
      professionalId: 'prof-123',
      serviceId: 'serv-123',
      startsAt: '2026-09-24T10:00:00.000Z',
      endsAt: '2026-09-24T10:45:00.000Z',
      status: 'CANCELLED',
      createdAt: '2026-09-24T08:00:00.000Z',
      updatedAt: '2026-09-24T09:00:00.000Z',
    };

    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      capturedUrl = url;
      capturedOptions = options;
      return new Response(
        JSON.stringify({
          message: 'Reserva cancelada com sucesso.',
          appointment: mockCancelledAppointment,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const result = await appointmentsApi.cancel(appointmentId);

    expect(capturedUrl).toContain(`/appointments/${appointmentId}/cancel`);
    expect(capturedOptions?.method).toBe('PATCH');

    const headers = capturedOptions?.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${mockToken}`);

    expect(result).toEqual(mockCancelledAppointment);
    expect(result.status).toBe('CANCELLED');
  });

  it('lança ApiError com status 404 quando a reserva não existe ou pertence a outra organização', async () => {
    const foreignAppointmentId = '99999999-9999-4999-8999-999999999999';

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          message: 'Reserva não encontrada na organização.',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    await expect(appointmentsApi.cancel(foreignAppointmentId)).rejects.toThrow(
      'Reserva não encontrada na organização.',
    );

    try {
      await appointmentsApi.cancel(foreignAppointmentId);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.message).toBe('Reserva não encontrada na organização.');
    }
  });

  it('atualiza faturamento previsto e contadores de forma imutável ao cancelar uma reserva', () => {
    const serviceCorte: Service = {
      id: 'serv-corte',
      organizationId: 'org-1',
      name: 'Corte Moderno',
      durationMinutes: 45,
      priceInCents: 8500, // R$ 85,00
      active: true,
      createdAt: '2026-09-24T00:00:00Z',
      updatedAt: '2026-09-24T00:00:00Z',
    };

    const serviceBarba: Service = {
      id: 'serv-barba',
      organizationId: 'org-1',
      name: 'Barba Completa',
      durationMinutes: 30,
      priceInCents: 4500, // R$ 45,00
      active: true,
      createdAt: '2026-09-24T00:00:00Z',
      updatedAt: '2026-09-24T00:00:00Z',
    };

    const initialAppointments: Appointment[] = [
      {
        id: 'apt-1',
        organizationId: 'org-1',
        customerId: 'cust-1',
        professionalId: 'prof-1',
        serviceId: serviceCorte.id,
        startsAt: '2026-09-24T10:00:00.000Z',
        endsAt: '2026-09-24T10:45:00.000Z',
        status: 'SCHEDULED',
        createdAt: '2026-09-24T08:00:00.000Z',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
      {
        id: 'apt-2',
        organizationId: 'org-1',
        customerId: 'cust-2',
        professionalId: 'prof-1',
        serviceId: serviceBarba.id,
        startsAt: '2026-09-24T11:00:00.000Z',
        endsAt: '2026-09-24T11:30:00.000Z',
        status: 'SCHEDULED',
        createdAt: '2026-09-24T08:00:00.000Z',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
    ];

    const serviceMap = new Map<string, Service>([
      [serviceCorte.id, serviceCorte],
      [serviceBarba.id, serviceBarba],
    ]);

    // Função que espelha o cálculo de métricas de AgendaPage
    const calculateMetrics = (apts: Appointment[], date: string) => {
      const dayAppointments = apts.filter((apt) => apt.startsAt.split('T')[0] === date);
      const active = dayAppointments.filter((apt) => apt.status === 'SCHEDULED');
      const cancelled = dayAppointments.filter((apt) => apt.status === 'CANCELLED');

      const totalRevenueCents = active.reduce((acc, apt) => {
        const svc = serviceMap.get(apt.serviceId);
        return acc + (svc ? svc.priceInCents : 0);
      }, 0);

      return {
        totalCount: dayAppointments.length,
        activeCount: active.length,
        cancelledCount: cancelled.length,
        revenueCents: totalRevenueCents,
      };
    };

    // Estado antes do cancelamento
    const beforeMetrics = calculateMetrics(initialAppointments, '2026-09-24');
    expect(beforeMetrics.totalCount).toBe(2);
    expect(beforeMetrics.activeCount).toBe(2);
    expect(beforeMetrics.cancelledCount).toBe(0);
    expect(beforeMetrics.revenueCents).toBe(8500 + 4500); // R$ 130,00

    // Simula o cancelamento da reserva 1 (R$ 85,00)
    const updatedAppointments = initialAppointments.map((apt) =>
      apt.id === 'apt-1' ? { ...apt, status: 'CANCELLED' as const } : apt,
    );

    // Estado após o cancelamento
    const afterMetrics = calculateMetrics(updatedAppointments, '2026-09-24');
    expect(afterMetrics.totalCount).toBe(2);
    expect(afterMetrics.activeCount).toBe(1);
    expect(afterMetrics.cancelledCount).toBe(1);
    expect(afterMetrics.revenueCents).toBe(4500); // Apenas R$ 45,00 da reserva ativa
  });
});
