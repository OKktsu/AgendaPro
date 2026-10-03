import React from 'react';
import { Button } from '../../components/common/Button.js';
import { ClockIcon } from '../../components/common/Icons.js';
import { Modal } from '../../components/common/Modal.js';
import type { Appointment, Customer, ProfessionalWithServices, Service } from '../../types/api.js';
import { formatCurrency, formatDateDisplay, formatTimeRange } from '../../utils/formatters.js';

interface CancelAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  appointment: Appointment | null;
  customer?: Customer;
  professional?: ProfessionalWithServices;
  service?: Service;
  isCancelling: boolean;
}

export const CancelAppointmentModal: React.FC<CancelAppointmentModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  appointment,
  customer,
  professional,
  service,
  isCancelling,
}) => {
  if (!isOpen || !appointment) return null;

  const datePart = appointment.startsAt.split('T')[0];

  return (
    <Modal
      isOpen={isOpen}
      onClose={isCancelling ? () => {} : onClose}
      title="Confirmar Cancelamento"
      maxWidth="480px"
    >
      <div className="cancel-modal-content">
        <p className="cancel-modal-description">
          Tem certeza de que deseja cancelar esta reserva? Confira os detalhes do agendamento:
        </p>

        <div className="cancel-modal-summary">
          <div className="cancel-summary-row">
            <span className="cancel-summary-label">Serviço</span>
            <span className="cancel-summary-value font-semibold">
              {service?.name || 'Serviço'}
              {service ? ` · ${formatCurrency(service.priceInCents)}` : ''}
            </span>
          </div>

          <div className="cancel-summary-row">
            <span className="cancel-summary-label">Data e Horário</span>
            <span className="cancel-summary-value flex items-center gap-1.5 tabular-nums">
              <ClockIcon size={15} />
              <span>
                {formatDateDisplay(datePart)} ·{' '}
                {formatTimeRange(appointment.startsAt, appointment.endsAt)}
              </span>
            </span>
          </div>

          <div className="cancel-summary-row">
            <span className="cancel-summary-label">Cliente</span>
            <span className="cancel-summary-value">
              {customer?.name || 'Cliente'}
              {customer?.phone ? ` (${customer.phone})` : ''}
            </span>
          </div>

          <div className="cancel-summary-row">
            <span className="cancel-summary-label">Profissional</span>
            <span className="cancel-summary-value">{professional?.name || 'Profissional'}</span>
          </div>
        </div>

        <div className="cancel-modal-warning">
          <strong>Atenção:</strong> Ao confirmar, o agendamento será cancelado e o horário ficará
          imediatamente disponível na agenda para novos atendimentos.
        </div>

        <div className="modal-actions mt-6">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isCancelling}>
            Manter Agendamento
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            isLoading={isCancelling}
            disabled={isCancelling}
          >
            Sim, Cancelar Agendamento
          </Button>
        </div>
      </div>
    </Modal>
  );
};
