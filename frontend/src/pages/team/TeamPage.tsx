import React, { useEffect, useState } from 'react';
import { professionalsApi, servicesApi } from '../../api/index.js';
import { Alert } from '../../components/common/Alert.js';
import { Button } from '../../components/common/Button.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import {
  BadgeIcon,
  ClockIcon,
  PlusIcon,
  ScissorsIcon,
  TrashIcon,
} from '../../components/common/Icons.js';
import { Input } from '../../components/common/Input.js';
import { Modal } from '../../components/common/Modal.js';
import type { ProfessionalWithServices, Service, Weekday, WorkSchedule } from '../../types/api.js';
import { getWeekdayLabel, WEEKDAY_LABELS } from '../../utils/formatters.js';

export const TeamPage: React.FC = () => {
  const [professionals, setProfessionals] = useState<ProfessionalWithServices[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [schedulesMap, setSchedulesMap] = useState<Record<string, WorkSchedule[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Alerts
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal 1: Novo Profissional
  const [isProfessionalModalOpen, setIsProfessionalModalOpen] = useState(false);
  const [professionalName, setProfessionalName] = useState('');
  const [isSubmittingProf, setIsSubmittingProf] = useState(false);

  // Modal 2: Vincular Serviço
  const [isAssignServiceModalOpen, setIsAssignServiceModalOpen] = useState(false);
  const [selectedProfessionalForService, setSelectedProfessionalForService] =
    useState<ProfessionalWithServices | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);

  // Modal 3: Adicionar Horário de Trabalho
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedProfessionalForSchedule, setSelectedProfessionalForSchedule] =
    useState<ProfessionalWithServices | null>(null);
  const [weekday, setWeekday] = useState<Weekday>('MONDAY');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [profsData, servicesData] = await Promise.all([
        professionalsApi.list(),
        servicesApi.list(),
      ]);

      setProfessionals(profsData);
      setServices(servicesData);

      // Carregar horários de cada profissional
      const schedulesObj: Record<string, WorkSchedule[]> = {};
      await Promise.all(
        profsData.map(async (prof) => {
          try {
            const schedules = await professionalsApi.listWorkSchedules(prof.id);
            schedulesObj[prof.id] = schedules;
          } catch {
            schedulesObj[prof.id] = [];
          }
        }),
      );
      setSchedulesMap(schedulesObj);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao carregar equipe e serviços.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Criação de Profissional
  const handleCreateProfessional = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!professionalName.trim()) return;

    setIsSubmittingProf(true);
    try {
      const created = await professionalsApi.create({
        name: professionalName.trim(),
        active: true,
      });

      setProfessionals((prev) => [...prev, { ...created, services: [] }]);
      setSchedulesMap((prev) => ({ ...prev, [created.id]: [] }));
      setSuccessMessage(`Profissional "${created.name}" cadastrado com sucesso!`);
      setIsProfessionalModalOpen(false);
      setProfessionalName('');
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao criar profissional.');
    } finally {
      setIsSubmittingProf(false);
    }
  };

  // Vinculação de Serviço
  const handleOpenAssignModal = (prof: ProfessionalWithServices) => {
    setSelectedProfessionalForService(prof);
    // Filtrar serviços que ainda não foram vinculados
    const linkedIds = new Set(prof.services?.map((s) => s.serviceId) || []);
    const available = services.filter((s) => !linkedIds.has(s.id));
    setSelectedServiceId(available[0]?.id || '');
    setErrorMessage(null);
    setIsAssignServiceModalOpen(true);
  };

  const handleAssignService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfessionalForService || !selectedServiceId) return;

    setIsSubmittingAssign(true);
    setErrorMessage(null);
    try {
      await professionalsApi.assignService(selectedProfessionalForService.id, selectedServiceId);

      // Recarrega lista para refletir os serviços vinculados
      const updatedProfs = await professionalsApi.list();
      setProfessionals(updatedProfs);
      setSuccessMessage('Serviço vinculado ao profissional com sucesso!');
      setIsAssignServiceModalOpen(false);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao vincular serviço.');
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // Adicionar Horário de Trabalho
  const handleOpenScheduleModal = (prof: ProfessionalWithServices) => {
    setSelectedProfessionalForSchedule(prof);
    setWeekday('MONDAY');
    setStartTime('08:00');
    setEndTime('18:00');
    setErrorMessage(null);
    setIsScheduleModalOpen(true);
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfessionalForSchedule) return;

    if (startTime >= endTime) {
      setErrorMessage('O horário inicial deve ser anterior ao horário final.');
      return;
    }

    setIsSubmittingSchedule(true);
    setErrorMessage(null);
    try {
      const newSchedule = await professionalsApi.createWorkSchedule(
        selectedProfessionalForSchedule.id,
        {
          weekday,
          startTime,
          endTime,
        },
      );

      setSchedulesMap((prev) => ({
        ...prev,
        [selectedProfessionalForSchedule.id]: [
          ...(prev[selectedProfessionalForSchedule.id] || []),
          newSchedule,
        ].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      }));

      setSuccessMessage('Horário de expediente cadastrado com sucesso!');
      setIsScheduleModalOpen(false);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao cadastrar horário de trabalho.');
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  const handleDeleteSchedule = async (profId: string, scheduleId: string) => {
    if (!window.confirm('Deseja realmente remover este horário de expediente?')) {
      return;
    }

    try {
      await professionalsApi.deleteWorkSchedule(scheduleId);
      setSchedulesMap((prev) => ({
        ...prev,
        [profId]: (prev[profId] || []).filter((s) => s.id !== scheduleId),
      }));
      setSuccessMessage('Horário removido com sucesso.');
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao remover horário.');
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipe & Expediente</h1>
          <p className="page-subtitle">
            Gerencie os profissionais, serviços executados e suas jornadas semanais de atendimento.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            setProfessionalName('');
            setErrorMessage(null);
            setIsProfessionalModalOpen(true);
          }}
          className="flex items-center gap-2"
        >
          <PlusIcon size={18} />
          <span>Novo Profissional</span>
        </Button>
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

      {/* Content */}
      {isLoading ? (
        <div className="loading-state">
          <div className="btn-spinner" style={{ width: 32, height: 32 }} />
          <span>Carregando profissionais e expedientes...</span>
        </div>
      ) : professionals.length === 0 ? (
        <EmptyState
          icon={<BadgeIcon size={48} />}
          title="Nenhum profissional cadastrado"
          description="Cadastre os profissionais da equipe para definir horários de trabalho e receber agendamentos."
          action={
            <Button
              variant="primary"
              onClick={() => {
                setProfessionalName('');
                setErrorMessage(null);
                setIsProfessionalModalOpen(true);
              }}
            >
              Cadastrar Primeiro Profissional
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {professionals.map((prof) => {
            const schedules = schedulesMap[prof.id] || [];
            const linkedServices = prof.services || [];

            return (
              <div key={prof.id} className="team-card">
                {/* Header do Card */}
                <div className="team-card-header">
                  <div className="team-card-profile">
                    <div className="team-avatar">{getInitials(prof.name)}</div>
                    <div>
                      <h3 className="team-name">{prof.name}</h3>
                      <span className="team-badge">{prof.active ? 'Ativo' : 'Inativo'}</span>
                    </div>
                  </div>

                  <div className="team-header-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenAssignModal(prof)}
                      className="flex items-center gap-1.5"
                    >
                      <ScissorsIcon size={16} />
                      <span>Vincular Serviço</span>
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleOpenScheduleModal(prof)}
                      className="flex items-center gap-1.5"
                    >
                      <PlusIcon size={16} />
                      <span>Adicionar Horário</span>
                    </Button>
                  </div>
                </div>

                {/* Seção 1: Serviços Vinculados */}
                <div className="team-section">
                  <h4 className="team-section-title flex items-center gap-2">
                    <ScissorsIcon size={16} />
                    <span>Serviços Vinculados ({linkedServices.length})</span>
                  </h4>
                  {linkedServices.length === 0 ? (
                    <p className="team-empty-hint">
                      Nenhum serviço vinculado. Clique em "Vincular Serviço" para habilitar
                      agendamentos para este profissional.
                    </p>
                  ) : (
                    <div className="pill-list">
                      {linkedServices.map((rel) => (
                        <span key={rel.serviceId} className="service-pill">
                          {rel.service?.name || 'Serviço'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Seção 2: Jornada Semanal */}
                <div className="team-section">
                  <h4 className="team-section-title flex items-center gap-2">
                    <ClockIcon size={16} />
                    <span>Jornada Semanal Cadastrada ({schedules.length})</span>
                  </h4>
                  {schedules.length === 0 ? (
                    <p className="team-empty-hint">
                      Nenhuma jornada semanal cadastrada. Clique em "Adicionar Horário" para definir
                      o expediente deste profissional.
                    </p>
                  ) : (
                    <div className="schedules-grid">
                      {schedules.map((sch) => (
                        <div key={sch.id} className="schedule-item">
                          <div className="schedule-info">
                            <span className="schedule-day">{getWeekdayLabel(sch.weekday)}</span>
                            <span className="schedule-time tabular-nums">
                              {sch.startTime} às {sch.endTime}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="schedule-delete-btn"
                            onClick={() => handleDeleteSchedule(prof.id, sch.id)}
                            title="Remover horário"
                            aria-label={`Remover horário de ${getWeekdayLabel(sch.weekday)}`}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal 1: Novo Profissional */}
      <Modal
        isOpen={isProfessionalModalOpen}
        onClose={() => setIsProfessionalModalOpen(false)}
        title="Novo Profissional"
      >
        <form onSubmit={handleCreateProfessional} className="modal-form">
          <Input
            label="Nome do Profissional"
            type="text"
            required
            value={professionalName}
            onChange={(e) => setProfessionalName(e.target.value)}
            placeholder="Ex: Lucas Silva"
          />
          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsProfessionalModalOpen(false)}
              disabled={isSubmittingProf}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmittingProf}>
              Salvar Profissional
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Vincular Serviço */}
      <Modal
        isOpen={isAssignServiceModalOpen}
        onClose={() => setIsAssignServiceModalOpen(false)}
        title={`Vincular Serviço a ${selectedProfessionalForService?.name || ''}`}
      >
        <form onSubmit={handleAssignService} className="modal-form">
          {services.length === 0 ? (
            <p className="team-empty-hint">
              Nenhum serviço disponível no catálogo. Cadastre serviços na aba "Serviços" primeiro.
            </p>
          ) : (
            <div className="input-group">
              <label htmlFor="service-select" className="input-label">
                Selecione o Serviço *
              </label>
              <select
                id="service-select"
                className="input-field"
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                required
              >
                {services.map((svc) => (
                  <option key={svc.id} value={svc.id}>
                    {svc.name} ({svc.durationMinutes} min)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsAssignServiceModalOpen(false)}
              disabled={isSubmittingAssign}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={services.length === 0 || !selectedServiceId}
              isLoading={isSubmittingAssign}
            >
              Vincular Serviço
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Adicionar Horário de Trabalho */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        title={`Adicionar Expediente - ${selectedProfessionalForSchedule?.name || ''}`}
      >
        <form onSubmit={handleCreateSchedule} className="modal-form">
          <div className="input-group">
            <label htmlFor="weekday-select" className="input-label">
              Dia da Semana *
            </label>
            <select
              id="weekday-select"
              className="input-field"
              value={weekday}
              onChange={(e) => setWeekday(e.target.value as Weekday)}
              required
            >
              {(Object.keys(WEEKDAY_LABELS) as Weekday[]).map((key) => (
                <option key={key} value={key}>
                  {WEEKDAY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid-2-cols">
            <Input
              label="Horário Inicial (HH:mm)"
              type="text"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="08:00"
              helperText="Ex: 08:00 ou 13:00"
            />
            <Input
              label="Horário Final (HH:mm)"
              type="text"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="18:00"
              helperText="Ex: 12:00 ou 18:00"
            />
          </div>

          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsScheduleModalOpen(false)}
              disabled={isSubmittingSchedule}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmittingSchedule}>
              Salvar Horário
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
