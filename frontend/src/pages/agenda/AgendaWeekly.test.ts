import { describe, expect, it } from 'vitest';
import type { Appointment } from '../../types/api.js';
import {
  getAppointmentDateString,
  getWeekDays,
  getWeekEnd,
  getWeekStart,
  isAppointmentOnDate,
} from '../../utils/formatters.js';

describe('Lógica de Negócio da Agenda Semanal (Frontend)', () => {
  const mockAppointments: Appointment[] = [
    {
      id: 'apt-1',
      organizationId: 'org-1',
      customerId: 'cust-1',
      professionalId: 'prof-1',
      serviceId: 'svc-1',
      startsAt: '2026-09-21T12:00:00.000Z', // Segunda, 09:00 BRT
      endsAt: '2026-09-21T12:45:00.000Z',
      status: 'SCHEDULED',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
    {
      id: 'apt-2',
      organizationId: 'org-1',
      customerId: 'cust-2',
      professionalId: 'prof-2',
      serviceId: 'svc-2',
      startsAt: '2026-09-21T17:00:00.000Z', // Segunda, 14:00 BRT
      endsAt: '2026-09-21T17:30:00.000Z',
      status: 'CANCELLED',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
    {
      id: 'apt-3',
      organizationId: 'org-1',
      customerId: 'cust-3',
      professionalId: 'prof-1',
      serviceId: 'svc-1',
      startsAt: '2026-09-23T13:00:00.000Z', // Quarta, 10:00 BRT
      endsAt: '2026-09-23T13:45:00.000Z',
      status: 'SCHEDULED',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
    {
      id: 'apt-4',
      organizationId: 'org-1',
      customerId: 'cust-4',
      professionalId: 'prof-2',
      serviceId: 'svc-2',
      startsAt: '2026-09-25T19:00:00.000Z', // Sexta, 16:00 BRT
      endsAt: '2026-09-25T19:30:00.000Z',
      status: 'SCHEDULED',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
    {
      id: 'apt-out-of-week',
      organizationId: 'org-1',
      customerId: 'cust-5',
      professionalId: 'prof-1',
      serviceId: 'svc-1',
      startsAt: '2026-09-30T13:00:00.000Z', // Próxima semana
      endsAt: '2026-09-30T13:45:00.000Z',
      status: 'SCHEDULED',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
  ];

  const selectedDate = '2026-09-24'; // Quinta-feira da semana de 21 a 27 de setembro
  const weekDays = getWeekDays(selectedDate);

  it('calcula o intervalo da semana correto (segunda a domingo)', () => {
    expect(weekDays).toHaveLength(7);
    expect(weekDays[0]).toBe('2026-09-21'); // Segunda
    expect(weekDays[6]).toBe('2026-09-27'); // Domingo
    expect(getWeekStart(selectedDate)).toBe('2026-09-21');
    expect(getWeekEnd(selectedDate)).toBe('2026-09-27');
  });

  it('filtra apenas agendamentos da semana ativa ignorando outras semanas', () => {
    const weekAppointments = mockAppointments.filter((apt) =>
      weekDays.includes(getAppointmentDateString(apt.startsAt)),
    );

    expect(weekAppointments).toHaveLength(4);
    expect(weekAppointments.map((a) => a.id)).toEqual(['apt-1', 'apt-2', 'apt-3', 'apt-4']);
    expect(weekAppointments.find((a) => a.id === 'apt-out-of-week')).toBeUndefined();
  });

  it('agrupa agendamentos por dia da semana preservando dias vazios', () => {
    const map: Record<string, Appointment[]> = {};
    for (const day of weekDays) {
      map[day] = [];
    }
    for (const apt of mockAppointments) {
      const aptDate = getAppointmentDateString(apt.startsAt);
      if (map[aptDate]) {
        map[aptDate].push(apt);
      }
    }

    // Segunda (2026-09-21) tem 2 agendamentos
    expect(map['2026-09-21']).toHaveLength(2);
    // Terça (2026-09-22) vazia
    expect(map['2026-09-22']).toHaveLength(0);
    // Quarta (2026-09-23) tem 1 agendamento
    expect(map['2026-09-23']).toHaveLength(1);
    // Quinta (2026-09-24) vazia
    expect(map['2026-09-24']).toHaveLength(0);
    // Sexta (2026-09-25) tem 1 agendamento
    expect(map['2026-09-25']).toHaveLength(1);
    // Sábado (2026-09-26) e Domingo (2026-09-27) vazios
    expect(map['2026-09-26']).toHaveLength(0);
    expect(map['2026-09-27']).toHaveLength(0);
  });

  it('aplica filtro por profissional na visão semanal', () => {
    const filterByProf1 = mockAppointments.filter(
      (apt) =>
        weekDays.includes(getAppointmentDateString(apt.startsAt)) &&
        apt.professionalId === 'prof-1',
    );

    expect(filterByProf1).toHaveLength(2);
    expect(filterByProf1.map((a) => a.id)).toEqual(['apt-1', 'apt-3']);

    const filterByProf2 = mockAppointments.filter(
      (apt) =>
        weekDays.includes(getAppointmentDateString(apt.startsAt)) &&
        apt.professionalId === 'prof-2',
    );

    expect(filterByProf2).toHaveLength(2);
    expect(filterByProf2.map((a) => a.id)).toEqual(['apt-2', 'apt-4']);
  });

  it('distingue reservas ativas e canceladas no cálculo semanal', () => {
    const weekAppointments = mockAppointments.filter((apt) =>
      weekDays.includes(getAppointmentDateString(apt.startsAt)),
    );

    const scheduled = weekAppointments.filter((a) => a.status === 'SCHEDULED');
    const cancelled = weekAppointments.filter((a) => a.status === 'CANCELLED');

    expect(scheduled).toHaveLength(3);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].id).toBe('apt-2');
  });

  it('identifica corretamente reservas na visão diária', () => {
    const dayAppointments = mockAppointments.filter((apt) =>
      isAppointmentOnDate(apt.startsAt, '2026-09-21'),
    );

    expect(dayAppointments).toHaveLength(2);
    expect(dayAppointments.map((a) => a.id)).toEqual(['apt-1', 'apt-2']);
  });
});
