import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/common/Alert.js';
import { Button } from '../../components/common/Button.js';
import { ClockIcon } from '../../components/common/Icons.js';
import { Input } from '../../components/common/Input.js';
import { Modal } from '../../components/common/Modal.js';
import type { Appointment, Customer, ProfessionalWithServices, Service } from '../../types/api.js';

interface NewAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate: string;
  customers: Customer[];
  professionals: ProfessionalWithServices[];
  services: Service[];
  onAppointmentCreated: (appointment: Appointment) => void;
}

export const NewAppointmentModal: React.FC<NewAppointmentModalProps> = ({
  isOpen,
  onClose,
  defaultDate,
  customers,
  professionals,
  services,
  onAppointmentCreated,
}) => {
  const [date, setDate] = useState(defaultDate);
  const [customerId, setCustomerId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');

  // Availability state
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sincroniza data inicial quando o modal abre
  useEffect(() => {
    if (isOpen) {
      setDate(defaultDate);
      setSelectedSlot('');
      setErrorMessage(null);
      setAvailabilityError(null);
      if (customers.length > 0 && !customerId) {
        setCustomerId(customers[0].id);
      }
      if (professionals.length > 0 && !professionalId) {
        setProfessionalId(professionals[0].id);
      }
    }
  }, [isOpen, defaultDate, customers, professionals, customerId, professionalId]);

  // Filtra serviços oferecidos pelo profissional selecionado
  const availableServices = useMemo<Service[]>(() => {
    const selectedProfessional = professionals.find((p) => p.id === professionalId);
    const allowedServiceIds = new Set(
      selectedProfessional?.services?.map((rel) => rel.serviceId) || [],
    );
    return services.filter((s) => allowedServiceIds.has(s.id));
  }, [professionals, professionalId, services]);

  // Ajusta o serviço selecionado se o profissional mudar
  useEffect(() => {
    if (availableServices.length > 0) {
      if (!serviceId || !availableServices.some((s) => s.id === serviceId)) {
        setServiceId(availableServices[0].id);
      }
    } else {
      setServiceId('');
      setAvailableSlots([]);
    }
  }, [availableServices, serviceId]);

  // Carrega disponibilidade sempre que profissional, serviço e data estiverem definidos
  const fetchAvailability = useCallback(
    async (profId: string, svcId: string, targetDate: string) => {
      if (!profId || !svcId || !targetDate) {
        setAvailableSlots([]);
        return;
      }

      setIsLoadingAvailability(true);
      setAvailabilityError(null);
      try {
        const result = await appointmentsApi.getAvailability({
          professionalId: profId,
          serviceId: svcId,
          date: targetDate,
        });

        setAvailableSlots(result.availableSlots || []);
        setSelectedSlot((current) =>
          current && !result.availableSlots.includes(current) ? '' : current,
        );
      } catch (err: unknown) {
        const error = err as { message?: string };
        setAvailableSlots([]);
        setAvailabilityError(error.message || 'Não foi possível carregar os horários disponíveis.');
      } finally {
        setIsLoadingAvailability(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isOpen && professionalId && serviceId && date) {
      fetchAvailability(professionalId, serviceId, date);
    }
  }, [isOpen, professionalId, serviceId, date, fetchAvailability]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!customerId) {
      setErrorMessage('Por favor, selecione um cliente.');
      return;
    }
    if (!professionalId) {
      setErrorMessage('Por favor, selecione um profissional.');
      return;
    }
    if (!serviceId) {
      setErrorMessage('Por favor, selecione um serviço.');
      return;
    }
    if (!selectedSlot) {
      setErrorMessage('Por favor, selecione um horário disponível.');
      return;
    }

    setIsSubmitting(true);
    try {
      // startsAt no fuso horário comercial America/Sao_Paulo (-03:00)
      const startsAt = `${date}T${selectedSlot}:00-03:00`;
      const created = await appointmentsApi.create({
        customerId,
        professionalId,
        serviceId,
        startsAt,
      });

      onAppointmentCreated(created);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        // Mensagem obrigatória de conflito
        setErrorMessage(
          'Este horário acabou de ser reservado. Atualize a disponibilidade e escolha outro.',
        );
        // Atualiza a disponibilidade imediatamente para refletir a reserva concorrente
        fetchAvailability(professionalId, serviceId, date);
      } else {
        const error = err as { message?: string };
        setErrorMessage(error.message || 'Erro ao realizar o agendamento.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Novo Agendamento" maxWidth="600px">
      <form onSubmit={handleSubmit} className="modal-form">
        {errorMessage && (
          <Alert type="error" message={errorMessage} onClose={() => setErrorMessage(null)} />
        )}

        <div className="grid-2-cols">
          {/* Data */}
          <Input
            label="Data do Atendimento"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          {/* Cliente */}
          <div className="input-group">
            <label htmlFor="customer-select" className="input-label">
              Cliente *
            </label>
            {customers.length === 0 ? (
              <p className="team-empty-hint">Nenhum cliente cadastrado.</p>
            ) : (
              <select
                id="customer-select"
                className="input-field"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              >
                <option value="">Selecione um cliente</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="grid-2-cols">
          {/* Profissional */}
          <div className="input-group">
            <label htmlFor="professional-select" className="input-label">
              Profissional *
            </label>
            {professionals.length === 0 ? (
              <p className="team-empty-hint">Nenhum profissional cadastrado.</p>
            ) : (
              <select
                id="professional-select"
                className="input-field"
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
                required
              >
                <option value="">Selecione um profissional</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Serviço */}
          <div className="input-group">
            <label htmlFor="service-select-modal" className="input-label">
              Serviço *
            </label>
            {availableServices.length === 0 ? (
              <p className="team-empty-hint">
                {professionalId
                  ? 'Este profissional não possui serviços vinculados.'
                  : 'Selecione um profissional primeiro.'}
              </p>
            ) : (
              <select
                id="service-select-modal"
                className="input-field"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                required
              >
                <option value="">Selecione um serviço</option>
                {availableServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes} min)
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Seleção de Horários Disponíveis */}
        <div className="slots-section">
          <div className="slots-header">
            <span className="slots-label flex items-center gap-1.5 font-semibold">
              <ClockIcon size={18} /> Horários Disponíveis
            </span>
            {professionalId && serviceId && date ? (
              <button
                type="button"
                className="slots-refresh-btn"
                onClick={() => fetchAvailability(professionalId, serviceId, date)}
                disabled={isLoadingAvailability}
              >
                {isLoadingAvailability ? 'Verificando...' : 'Atualizar'}
              </button>
            ) : null}
          </div>

          {isLoadingAvailability ? (
            <div className="slots-loading">
              <div className="btn-spinner" style={{ width: 20, height: 20 }} />
              <span>Consultando disponibilidade...</span>
            </div>
          ) : availabilityError ? (
            <p className="slots-error">{availabilityError}</p>
          ) : availableSlots.length === 0 ? (
            <p className="slots-empty">
              {professionalId && serviceId
                ? 'Nenhum horário disponível para este profissional nesta data.'
                : 'Selecione o profissional e o serviço para visualizar os horários livres.'}
            </p>
          ) : (
            <div className="slots-grid">
              {availableSlots.map((slot) => {
                const isSelected = selectedSlot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`slot-pill ${isSelected ? 'slot-pill-selected' : ''}`}
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!customerId || !professionalId || !serviceId || !selectedSlot || isSubmitting}
            isLoading={isSubmitting}
          >
            Confirmar Reserva
          </Button>
        </div>
      </form>
    </Modal>
  );
};
