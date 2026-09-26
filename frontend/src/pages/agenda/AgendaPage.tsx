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
  addWeeks,
  formatCurrency,
  formatDateDisplay,
  formatShortDate,
  formatTimeRange,
  formatWeekRangeDisplay,
  getAppointmentDateString,
  getTodayDateString,
  getWeekDays,
  isAppointmentOnDate,
} from '../../utils/formatters.js';
import { NewAppointmentModal } from './NewAppointmentModal.js';

const SESSION_VIEW_MODE_KEY = 'agendapro_agenda_view_mode';

export const AgendaPage: React.FC = () => {
  const [viewMode, setViewMode] = useState<'DAY' | 'WEEK'>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_VIEW_MODE_KEY);
      return saved === 'WEEK' ? 'WEEK' : 'DAY';
    } catch {
      return 'DAY';
    }
  });

  const [selectedDate, setSelectedDate] = useState(() => getTodayDateString());
  const [selectedProfessionalFilter, setSelectedProfessionalFilter] = useState<string>('ALL');

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalWithServices[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
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

  const handleViewModeChange = (mode: 'DAY' | 'WEEK') => {
    setViewMode(mode);
    try {
      sessionStorage.setItem(SESSION_VIEW_MODE_KEY, mode);
    } catch {
      // Ignorar caso sessionStorage não esteja disponível
    }
  };

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

  // Lista dos 7 dias da semana selecionada (Segunda a Domingo)
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  // Filtragem dos agendamentos do dia selecionado
  const appointmentsForSelectedDate = useMemo(() => {
    return appointments.filter((apt) => {
      const matchDate = isAppointmentOnDate(apt.startsAt, selectedDate);
      const matchProf =
        selectedProfessionalFilter === 'ALL' || apt.professionalId === selectedProfessionalFilter;
      return matchDate && matchProf;
    });
  }, [appointments, selectedDate, selectedProfessionalFilter]);

  // Filtragem dos agendamentos da semana selecionada
  const appointmentsForSelectedWeek = useMemo(() => {
    return appointments.filter((apt) => {
      const aptDate = getAppointmentDateString(apt.startsAt);
      const matchWeek = weekDays.includes(aptDate);
      const matchProf =
        selectedProfessionalFilter === 'ALL' || apt.professionalId === selectedProfessionalFilter;
      return matchWeek && matchProf;
    });
  }, [appointments, weekDays, selectedProfessionalFilter]);

  // Agrupamento dos agendamentos por dia da semana
  const appointmentsByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const day of weekDays) {
      map[day] = [];
    }
    for (const apt of appointmentsForSelectedWeek) {
      const aptDate = getAppointmentDateString(apt.startsAt);
      if (map[aptDate]) {
        map[aptDate].push(apt);
      }
    }
    for (const day of weekDays) {
      map[day].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [weekDays, appointmentsForSelectedWeek]);

  // Métricas calculadas estritamente com dados reais para a visão atual
  const metrics = useMemo(() => {
    const currentList =
      viewMode === 'WEEK' ? appointmentsForSelectedWeek : appointmentsForSelectedDate;
    const active = currentList.filter((apt) => apt.status === 'SCHEDULED');
    const cancelled = currentList.filter((apt) => apt.status === 'CANCELLED');

    const totalRevenueCents = active.reduce((acc, apt) => {
      const svc = serviceMap.get(apt.serviceId);
      return acc + (svc ? svc.priceInCents : 0);
    }, 0);

    return {
      periodLabel: viewMode === 'WEEK' ? 'Agendamentos da Semana' : 'Agendamentos do Dia',
      totalCount: currentList.length,
      activeCount: active.length,
      cancelledCount: cancelled.length,
      revenueCents: totalRevenueCents,
    };
  }, [viewMode, appointmentsForSelectedWeek, appointmentsForSelectedDate, serviceMap]);

  // Reserva selecionada para o painel de detalhes (Inspector)
  const selectedAppointment = useMemo(() => {
    const currentList =
      viewMode === 'WEEK' ? appointmentsForSelectedWeek : appointmentsForSelectedDate;
    if (!selectedAppointmentId) {
      return currentList[0] || null;
    }
    return appointments.find((a) => a.id === selectedAppointmentId) || null;
  }, [
    selectedAppointmentId,
    viewMode,
    appointmentsForSelectedWeek,
    appointmentsForSelectedDate,
    appointments,
  ]);

  // Navegação diária
  const handlePrevDay = () => setSelectedDate((prev) => addDays(prev, -1));
  const handleNextDay = () => setSelectedDate((prev) => addDays(prev, 1));
  const handleToday = () => setSelectedDate(getTodayDateString());

  // Navegação semanal
  const handlePrevWeek = () => setSelectedDate((prev) => addWeeks(prev, -1));
  const handleNextWeek = () => setSelectedDate((prev) => addWeeks(prev, 1));
  const handleThisWeek = () => setSelectedDate(getTodayDateString());

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!window.confirm('Tem certeza de que deseja cancelar esta reserva?')) {
      return;
    }

    setIsCancelling(true);
    setErrorMessage(null);
    try {
      const updated = await appointmentsApi.cancel(appointmentId);
      setAppointments((prev) => prev.map((apt) => (apt.id === updated.id ? updated : apt)));
      setSuccessMessage('Reserva cancelada com sucesso!');
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao cancelar reserva.');
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

  // Contagens para o ribbon de profissionais conforme a visão atual
  const allFilterCount = useMemo(() => {
    if (viewMode === 'WEEK') {
      return appointments.filter((a) => weekDays.includes(getAppointmentDateString(a.startsAt)))
        .length;
    }
    return appointments.filter((a) => isAppointmentOnDate(a.startsAt, selectedDate)).length;
  }, [viewMode, appointments, weekDays, selectedDate]);

  const getProfFilterCount = (profId: string) => {
    if (viewMode === 'WEEK') {
      return appointments.filter(
        (a) =>
          a.professionalId === profId && weekDays.includes(getAppointmentDateString(a.startsAt)),
      ).length;
    }
    return appointments.filter(
      (a) => a.professionalId === profId && isAppointmentOnDate(a.startsAt, selectedDate),
    ).length;
  };

  // Painel lateral de detalhes (Inspector) reutilizado nas visões diária e semanal
  const renderInspectorPanel = () => {
    if (!selectedAppointment) return null;
    const customer = customerMap.get(selectedAppointment.customerId);
    const professional = professionalMap.get(selectedAppointment.professionalId);
    const service = serviceMap.get(selectedAppointment.serviceId);
    const isCancelled = selectedAppointment.status === 'CANCELLED';

    return (
      <div className="agenda-inspector-panel">
        <div className="inspector-card">
          <div className="inspector-header">
            <div className="flex items-center gap-2">
              <span className={`inspector-dot ${isCancelled ? 'bg-rose-500' : 'bg-primary'}`} />
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
                  {formatTimeRange(selectedAppointment.startsAt, selectedAppointment.endsAt)} (
                  {service?.durationMinutes || 0} min)
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
              <span className="inspector-prof-name">{professional?.name || 'Profissional'}</span>
            </div>
          </div>

          {/* Ações */}
          {!isCancelled ? (
            <div className="inspector-actions">
              <Button
                type="button"
                variant="danger"
                className="w-full flex items-center justify-center gap-2"
                onClick={() => handleCancelAppointment(selectedAppointment.id)}
                isLoading={isCancelling}
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
      </div>
    );
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
            <h1 className="agenda-heading">
              {viewMode === 'WEEK' ? 'Agenda Semanal' : 'Agenda Diária'}
            </h1>
          </div>

          {/* Alternância de Modo de Visualização (Dia / Semana) */}
          <div className="view-mode-switcher" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'DAY' ? 'view-mode-btn-active' : ''}`}
              onClick={() => handleViewModeChange('DAY')}
            >
              Dia
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'WEEK' ? 'view-mode-btn-active' : ''}`}
              onClick={() => handleViewModeChange('WEEK')}
            >
              Semana
            </button>
          </div>

          {/* Navegador de Data e Período */}
          <div className="date-navigator">
            <button
              type="button"
              className="date-nav-btn"
              onClick={viewMode === 'WEEK' ? handlePrevWeek : handlePrevDay}
              aria-label={viewMode === 'WEEK' ? 'Semana anterior' : 'Dia anterior'}
              title={viewMode === 'WEEK' ? 'Semana anterior' : 'Dia anterior'}
            >
              <ChevronLeftIcon size={18} />
            </button>
            <div className="date-nav-display">
              <CalendarIcon size={18} className="text-primary" />
              <span className="date-nav-text">
                {viewMode === 'WEEK'
                  ? formatWeekRangeDisplay(selectedDate)
                  : formatDateDisplay(selectedDate)}
              </span>
            </div>
            <button
              type="button"
              className="date-nav-btn"
              onClick={viewMode === 'WEEK' ? handleNextWeek : handleNextDay}
              aria-label={viewMode === 'WEEK' ? 'Próxima semana' : 'Próximo dia'}
              title={viewMode === 'WEEK' ? 'Próxima semana' : 'Próximo dia'}
            >
              <ChevronRightIcon size={18} />
            </button>
            <button
              type="button"
              className="date-today-btn"
              onClick={viewMode === 'WEEK' ? handleThisWeek : handleToday}
            >
              {viewMode === 'WEEK' ? 'Esta semana' : 'Hoje'}
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
            <span className="metric-label">{metrics.periodLabel}</span>
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
          <span className="prof-filter-count">{allFilterCount}</span>
        </button>

        {professionals.map((prof) => {
          const isSelected = selectedProfessionalFilter === prof.id;
          const count = getProfFilterCount(prof.id);

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
      ) : viewMode === 'DAY' ? (
        /* VISÃO DIÁRIA */
        appointmentsForSelectedDate.length === 0 ? (
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
                          <span className="agenda-card-customer">
                            {customer?.name || 'Cliente'}
                          </span>
                        </div>
                        <Badge variant={isCancelled ? 'cancelled' : 'scheduled'} dot>
                          {isCancelled ? 'Cancelado' : 'Confirmado'}
                        </Badge>
                      </div>

                      <div className="agenda-card-footer">
                        <span className="agenda-card-time flex items-center gap-1.5 tabular-nums">
                          <ClockIcon size={14} />
                          {formatTimeRange(apt.startsAt, apt.endsAt)} (
                          {service?.durationMinutes || 0}m)
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

            {/* Coluna Direita: Painel Inspector */}
            {selectedAppointment && renderInspectorPanel()}
          </div>
        )
      ) : (
        /* VISÃO SEMANAL */
        <div className="agenda-grid-workspace">
          {/* Canvas Semanal com 7 colunas */}
          <div className="agenda-week-container">
            {appointmentsForSelectedWeek.length === 0 && (
              <div className="agenda-week-empty-banner">
                <div className="flex items-center gap-2">
                  <CalendarIcon size={18} className="text-primary" />
                  <span>
                    Nenhuma reserva encontrada nesta semana ({formatWeekRangeDisplay(selectedDate)}
                    ).
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(true)}>
                  Novo Agendamento
                </Button>
              </div>
            )}

            <div className="agenda-week-grid">
              {weekDays.map((dayDateStr) => {
                const dayApts = appointmentsByDay[dayDateStr] || [];
                const isToday = dayDateStr === getTodayDateString();
                const [y, m, d] = dayDateStr.split('-').map(Number);
                const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
                const dayIndex = (dateObj.getUTCDay() + 6) % 7; // 0 = Segunda, ..., 6 = Domingo
                const weekdayShort = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
                const dayLabel = weekdayShort[dayIndex];

                return (
                  <div
                    key={dayDateStr}
                    className={`agenda-week-col ${isToday ? 'agenda-week-col-today' : ''}`}
                  >
                    <div className="agenda-week-col-header">
                      <div className="week-col-header-top">
                        <span className="week-col-day-name">{dayLabel}</span>
                        {isToday && <span className="week-col-today-badge">Hoje</span>}
                      </div>
                      <div className="week-col-header-bottom">
                        <span className="week-col-date-num">{formatShortDate(dayDateStr)}</span>
                        <span className="week-col-count">{dayApts.length}</span>
                      </div>
                    </div>

                    <div className="agenda-week-col-body">
                      {dayApts.length === 0 ? (
                        <div className="week-day-empty">
                          <span>Sem reservas</span>
                        </div>
                      ) : (
                        dayApts.map((apt) => {
                          const customer = customerMap.get(apt.customerId);
                          const professional = professionalMap.get(apt.professionalId);
                          const service = serviceMap.get(apt.serviceId);
                          const isSelected = selectedAppointment?.id === apt.id;
                          const isCancelled = apt.status === 'CANCELLED';

                          return (
                            <div
                              key={apt.id}
                              className={`agenda-week-card ${isSelected ? 'agenda-week-card-active' : ''} ${isCancelled ? 'agenda-week-card-cancelled' : ''}`}
                              onClick={() => setSelectedAppointmentId(apt.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') setSelectedAppointmentId(apt.id);
                              }}
                            >
                              <div
                                className={`agenda-week-card-strip ${isCancelled ? 'bg-rose-500' : 'bg-primary'}`}
                              />
                              <div className="agenda-week-card-content">
                                <div className="agenda-week-card-header">
                                  <span className="agenda-week-card-time tabular-nums">
                                    <ClockIcon size={12} />
                                    {formatTimeRange(apt.startsAt, apt.endsAt)}
                                  </span>
                                  <Badge variant={isCancelled ? 'cancelled' : 'scheduled'}>
                                    {isCancelled ? 'Cancelado' : 'Confirmado'}
                                  </Badge>
                                </div>
                                <h5
                                  className="agenda-week-card-service truncate"
                                  title={service?.name || 'Serviço'}
                                >
                                  {service?.name || 'Serviço'}
                                </h5>
                                <div
                                  className="agenda-week-card-customer truncate"
                                  title={customer?.name || 'Cliente'}
                                >
                                  {customer?.name || 'Cliente'}
                                </div>
                                <div
                                  className="agenda-week-card-prof truncate"
                                  title={professional?.name || 'Profissional'}
                                >
                                  {professional?.name}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coluna Direita: Painel Inspector */}
          {selectedAppointment && renderInspectorPanel()}
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
    </div>
  );
};
