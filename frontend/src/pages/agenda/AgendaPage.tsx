import React, { useEffect, useMemo, useState } from 'react';
import { appointmentsApi, customersApi, professionalsApi, servicesApi } from '../../api/index.js';
import { Alert } from '../../components/common/Alert.js';
import { Badge } from '../../components/common/Badge.js';
import { Button } from '../../components/common/Button.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  DollarIcon,
  PhoneIcon,
  PlusIcon,
  UsersIcon,
} from '../../components/common/Icons.js';
import type { Appointment, Customer, ProfessionalWithServices, Service } from '../../types/api.js';
import {
  addDays,
  formatCurrency,
  formatDateDisplay,
  formatTimeRange,
  getTodayDateString,
} from '../../utils/formatters.js';
import { CancelAppointmentModal } from './CancelAppointmentModal.js';
import { NewAppointmentModal } from './NewAppointmentModal.js';

export const AgendaPage: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(() => getTodayDateString());
  const [selectedProfessionalFilter, setSelectedProfessionalFilter] = useState<string>('ALL');

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalWithServices[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [appointmentToCancel, setAppointmentToCancel] = useState<Appointment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Alerts
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [aptsData, custsData, profsData, svcsData] = await Promise.all([
        appointmentsApi.list(),
        customersApi.list(),
        professionalsApi.list(),
        servicesApi.list(),
      ]);

      setAppointments(aptsData);
      setCustomers(custsData);
      setProfessionals(profsData);
      setServices(svcsData);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao carregar dados da agenda.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Mapas para lookup rápido de entidades
  const customerMap = useMemo(() => {
    return new Map(customers.map((c) => [c.id, c]));
  }, [customers]);

  const professionalMap = useMemo(() => {
    return new Map(professionals.map((p) => [p.id, p]));
  }, [professionals]);

  const serviceMap = useMemo(() => {
    return new Map(services.map((s) => [s.id, s]));
  }, [services]);

  // Filtragem dos agendamentos do dia selecionado
  const appointmentsForSelectedDate = useMemo(() => {
    return appointments.filter((apt) => {
      // Data ISO: converter ou comparar YYYY-MM-DD
      const datePart = apt.startsAt.split('T')[0];
      const matchDate = datePart === selectedDate;
      const matchProf =
        selectedProfessionalFilter === 'ALL' || apt.professionalId === selectedProfessionalFilter;
      return matchDate && matchProf;
    });
  }, [appointments, selectedDate, selectedProfessionalFilter]);

  // Métricas calculadas estritamente com dados reais
  const metrics = useMemo(() => {
    const dayAppointments = appointments.filter(
      (apt) => apt.startsAt.split('T')[0] === selectedDate,
    );
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
  }, [appointments, selectedDate, serviceMap]);

  // Reserva selecionada para o painel de detalhes (Inspector)
  const selectedAppointment = useMemo(() => {
    if (!selectedAppointmentId) {
      return appointmentsForSelectedDate[0] || null;
    }
    return appointments.find((a) => a.id === selectedAppointmentId) || null;
  }, [selectedAppointmentId, appointmentsForSelectedDate, appointments]);

  const handlePrevDay = () => setSelectedDate((prev) => addDays(prev, -1));
  const handleNextDay = () => setSelectedDate((prev) => addDays(prev, 1));
  const handleToday = () => setSelectedDate(getTodayDateString());

  const handleConfirmCancel = async () => {
    if (isCancelling || !appointmentToCancel) {
      return;
    }

    setIsCancelling(true);
    setErrorMessage(null);
    try {
      const updated = await appointmentsApi.cancel(appointmentToCancel.id);
      setAppointments((prev) => prev.map((apt) => (apt.id === updated.id ? updated : apt)));
      setSuccessMessage('Reserva cancelada com sucesso!');
      setAppointmentToCancel(null);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao cancelar reserva.');
      setAppointmentToCancel(null);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleAppointmentCreated = (newAppointment: Appointment) => {
    setAppointments((prev) => [...prev, newAppointment]);
    setSelectedAppointmentId(newAppointment.id);
    setSuccessMessage('Novo agendamento realizado com sucesso!');
  };

  const getInitials = (name?: string) => {
    if (!name) return 'AP';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="agenda-layout">
      {/* Top Command Bar */}
      <div className="agenda-command-bar">
        <div className="agenda-command-left">
          <div>
            <div className="agenda-tagline">
              <span className="agenda-dot" /> Visão Operacional da Agenda
            </div>
            <h1 className="agenda-heading">Agenda Diária</h1>
          </div>

          {/* Navegador de Data */}
          <div className="date-navigator">
            <button
              type="button"
              className="date-nav-btn"
              onClick={handlePrevDay}
              aria-label="Dia anterior"
              title="Dia anterior"
            >
              <ChevronLeftIcon size={18} />
            </button>
            <div className="date-nav-display">
              <CalendarIcon size={18} className="text-primary" />
              <span className="date-nav-text">{formatDateDisplay(selectedDate)}</span>
            </div>
            <button
              type="button"
              className="date-nav-btn"
              onClick={handleNextDay}
              aria-label="Próximo dia"
              title="Próximo dia"
            >
              <ChevronRightIcon size={18} />
            </button>
            <button type="button" className="date-today-btn" onClick={handleToday}>
              Hoje
            </button>
          </div>
        </div>

        {/* CTA Button */}
        <div className="agenda-command-right">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2"
          >
            <PlusIcon size={18} />
            <span>Novo Agendamento</span>
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {successMessage && (
        <Alert
          type="success"
          message={successMessage}
          onClose={() => setSuccessMessage(null)}
          className="mb-4"
        />
      )}
      {errorMessage && (
        <Alert
          type="error"
          message={errorMessage}
          onClose={() => setErrorMessage(null)}
          className="mb-4"
        />
      )}

      {/* Micro-cards de Métricas Operacionais Reais */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-info">
            <span className="metric-label">Agendamentos do Dia</span>
            <span className="metric-value tabular-nums">
              {metrics.totalCount} <span className="metric-unit">reservas</span>
            </span>
            <span className="metric-subtext">
              {metrics.activeCount} ativas · {metrics.cancelledCount} canceladas
            </span>
          </div>
          <div className="metric-icon-box text-primary">
            <CalendarIcon size={24} />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-info">
            <span className="metric-label">Faturamento Previsto</span>
            <span className="metric-value tabular-nums">
              {formatCurrency(metrics.revenueCents)}
            </span>
            <span className="metric-subtext">Soma dos atendimentos agendados</span>
          </div>
          <div className="metric-icon-box text-emerald-600">
            <DollarIcon size={24} />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-info">
            <span className="metric-label">Profissionais Ativos</span>
            <span className="metric-value tabular-nums">
              {professionals.length} <span className="metric-unit">membros</span>
            </span>
            <span className="metric-subtext">Disponíveis para atendimento</span>
          </div>
          <div className="metric-icon-box text-blue-600">
            <UsersIcon size={24} />
          </div>
        </div>
      </div>

      {/* Ribbon de Filtro por Profissional */}
      <div className="professional-filter-ribbon">
        <button
          type="button"
          className={`prof-filter-btn ${selectedProfessionalFilter === 'ALL' ? 'prof-filter-btn-active' : ''}`}
          onClick={() => setSelectedProfessionalFilter('ALL')}
        >
          <span className="prof-filter-dot" />
          <span>Todos os profissionais</span>
          <span className="prof-filter-count">
            {appointments.filter((a) => a.startsAt.split('T')[0] === selectedDate).length}
          </span>
        </button>

        {professionals.map((prof) => {
          const isSelected = selectedProfessionalFilter === prof.id;
          const count = appointments.filter(
            (a) => a.startsAt.split('T')[0] === selectedDate && a.professionalId === prof.id,
          ).length;

          return (
            <button
              key={prof.id}
              type="button"
              className={`prof-filter-btn ${isSelected ? 'prof-filter-btn-active' : ''}`}
              onClick={() => setSelectedProfessionalFilter(prof.id)}
            >
              <div className="prof-mini-avatar">{getInitials(prof.name)}</div>
              <span>{prof.name}</span>
              <span className="prof-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Main Agenda Grid: Cards Canvas + Inspector Panel */}
      {isLoading ? (
        <div className="loading-state">
          <div className="btn-spinner" style={{ width: 32, height: 32 }} />
          <span>Carregando agenda...</span>
        </div>
      ) : appointmentsForSelectedDate.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={48} />}
          title="Nenhuma reserva para este dia"
          description="Não há atendimentos marcados nesta data. Clique em 'Novo Agendamento' para criar uma reserva."
          action={
            <Button variant="primary" onClick={() => setIsModalOpen(true)}>
              Novo Agendamento
            </Button>
          }
        />
      ) : (
        <div className="agenda-grid-workspace">
          {/* Coluna Esquerda: Lista de Agendamentos */}
          <div className="agenda-appointments-list">
            {appointmentsForSelectedDate.map((apt) => {
              const customer = customerMap.get(apt.customerId);
              const professional = professionalMap.get(apt.professionalId);
              const service = serviceMap.get(apt.serviceId);
              const isSelected = selectedAppointment?.id === apt.id;
              const isCancelled = apt.status === 'CANCELLED';

              return (
                <div
                  key={apt.id}
                  className={`agenda-card ${isSelected ? 'agenda-card-active' : ''} ${isCancelled ? 'agenda-card-cancelled' : ''}`}
                  onClick={() => setSelectedAppointmentId(apt.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelectedAppointmentId(apt.id);
                  }}
                >
                  <div
                    className={`agenda-card-strip ${isCancelled ? 'bg-rose-500' : 'bg-primary'}`}
                  />
                  <div className="agenda-card-main">
                    <div className="agenda-card-top">
                      <div>
                        <h4 className="agenda-card-service">{service?.name || 'Serviço'}</h4>
                        <span className="agenda-card-customer">{customer?.name || 'Cliente'}</span>
                      </div>
                      <Badge variant={isCancelled ? 'cancelled' : 'scheduled'} dot>
                        {isCancelled ? 'Cancelado' : 'Confirmado'}
                      </Badge>
                    </div>

                    <div className="agenda-card-footer">
                      <span className="agenda-card-time flex items-center gap-1.5 tabular-nums">
                        <ClockIcon size={14} />
                        {formatTimeRange(apt.startsAt, apt.endsAt)} ({service?.durationMinutes || 0}
                        m)
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="agenda-card-prof">{professional?.name}</span>
                        <span className="agenda-card-price tabular-nums">
                          {service ? formatCurrency(service.priceInCents) : 'R$ 0,00'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Coluna Direita: Painel Inspector de Atendimento Selecionado */}
          {selectedAppointment && (
            <div className="agenda-inspector-panel">
              {(() => {
                const customer = customerMap.get(selectedAppointment.customerId);
                const professional = professionalMap.get(selectedAppointment.professionalId);
                const service = serviceMap.get(selectedAppointment.serviceId);
                const isCancelled = selectedAppointment.status === 'CANCELLED';

                return (
                  <div className="inspector-card">
                    <div className="inspector-header">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inspector-dot ${isCancelled ? 'bg-rose-500' : 'bg-primary'}`}
                        />
                        <span className="inspector-tag">Atendimento Selecionado</span>
                      </div>
                      <Badge variant={isCancelled ? 'cancelled' : 'scheduled'}>
                        {isCancelled ? 'Cancelado' : 'Agendado'}
                      </Badge>
                    </div>

                    {/* Serviço e Preço */}
                    <div className="inspector-service-box">
                      <h3 className="inspector-service-name">{service?.name || 'Serviço'}</h3>
                      <div className="inspector-meta-row">
                        <div className="flex items-center gap-1 text-slate-600">
                          <ClockIcon size={16} />
                          <span className="tabular-nums">
                            {formatTimeRange(
                              selectedAppointment.startsAt,
                              selectedAppointment.endsAt,
                            )}{' '}
                            ({service?.durationMinutes || 0} min)
                          </span>
                        </div>
                        <span className="inspector-price tabular-nums">
                          {service ? formatCurrency(service.priceInCents) : 'R$ 0,00'}
                        </span>
                      </div>
                    </div>

                    {/* Ficha do Cliente */}
                    <div className="inspector-client-box">
                      <div className="flex items-center gap-3">
                        <div className="inspector-client-avatar">{getInitials(customer?.name)}</div>
                        <div>
                          <h4 className="inspector-client-name">{customer?.name || 'Cliente'}</h4>
                          <span className="inspector-client-phone tabular-nums">
                            {customer?.phone || 'Sem telefone'}
                          </span>
                        </div>
                      </div>
                      {customer?.phone && (
                        <a
                          href={`tel:${customer.phone}`}
                          className="inspector-phone-btn"
                          title="Ligar para cliente"
                          aria-label={`Ligar para ${customer.name}`}
                        >
                          <PhoneIcon size={16} />
                        </a>
                      )}
                    </div>

                    {/* Profissional Responsável */}
                    <div className="inspector-prof-row">
                      <span className="inspector-prof-label">Profissional:</span>
                      <div className="flex items-center gap-2">
                        <div className="prof-mini-avatar">{getInitials(professional?.name)}</div>
                        <span className="inspector-prof-name">
                          {professional?.name || 'Profissional'}
                        </span>
                      </div>
                    </div>

                    {/* Ações */}
                    {!isCancelled ? (
                      <div className="inspector-actions">
                        <Button
                          type="button"
                          variant="danger"
                          className="w-full flex items-center justify-center gap-2"
                          onClick={() => setAppointmentToCancel(selectedAppointment)}
                          disabled={isCancelling}
                        >
                          <CloseIcon size={18} />
                          <span>Cancelar Agendamento</span>
                        </Button>
                      </div>
                    ) : (
                      <div className="inspector-cancelled-notice">
                        Esta reserva foi cancelada e o horário está livre para novos agendamentos.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Modal de Novo Agendamento */}
      <NewAppointmentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        defaultDate={selectedDate}
        customers={customers}
        professionals={professionals}
        services={services}
        onAppointmentCreated={handleAppointmentCreated}
      />

      {/* Modal de Confirmação de Cancelamento */}
      <CancelAppointmentModal
        isOpen={Boolean(appointmentToCancel)}
        onClose={() => setAppointmentToCancel(null)}
        onConfirm={handleConfirmCancel}
        appointment={appointmentToCancel}
        customer={appointmentToCancel ? customerMap.get(appointmentToCancel.customerId) : undefined}
        professional={
          appointmentToCancel ? professionalMap.get(appointmentToCancel.professionalId) : undefined
        }
        service={appointmentToCancel ? serviceMap.get(appointmentToCancel.serviceId) : undefined}
        isCancelling={isCancelling}
      />
    </div>
  );
};
