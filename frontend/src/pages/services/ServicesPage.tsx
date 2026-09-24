import React, { useEffect, useState } from 'react';
import { servicesApi } from '../../api/index.js';
import { Alert } from '../../components/common/Alert.js';
import { Button } from '../../components/common/Button.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { ClockIcon, DollarIcon, PlusIcon, ScissorsIcon } from '../../components/common/Icons.js';
import { Input } from '../../components/common/Input.js';
import { Modal } from '../../components/common/Modal.js';
import type { Service } from '../../types/api.js';
import { formatCurrency, parseReaisToCents } from '../../utils/formatters.js';

export const ServicesPage: React.FC = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Alerts
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('45');
  const [priceInReais, setPriceInReais] = useState('85,00');

  const loadServices = async () => {
    setIsLoading(true);
    try {
      const data = await servicesApi.list();
      setServices(data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao carregar lista de serviços.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const handleOpenCreateModal = () => {
    setName('');
    setDurationMinutes('45');
    setPriceInReais('85,00');
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const duration = parseInt(durationMinutes, 10);
    if (isNaN(duration) || duration <= 0) {
      setErrorMessage('A duração deve ser um número inteiro de minutos maior que zero.');
      return;
    }

    const priceInCents = parseReaisToCents(priceInReais);
    if (priceInCents < 0) {
      setErrorMessage('O preço deve ser maior ou igual a zero.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await servicesApi.create({
        name: name.trim(),
        durationMinutes: duration,
        priceInCents,
        active: true,
      });

      setServices((prev) => [...prev, created]);
      setSuccessMessage(`Serviço "${created.name}" cadastrado com sucesso!`);
      setIsModalOpen(false);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao cadastrar o serviço.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Serviços</h1>
          <p className="page-subtitle">
            Gerencie o catálogo de procedimentos, durações e valores oferecidos.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2"
        >
          <PlusIcon size={18} />
          <span>Novo Serviço</span>
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
          <span>Carregando serviços...</span>
        </div>
      ) : services.length === 0 ? (
        <EmptyState
          icon={<ScissorsIcon size={48} />}
          title="Nenhum serviço cadastrado"
          description="Cadastre os serviços oferecidos pela sua empresa para que os clientes possam agendar horários."
          action={
            <Button variant="primary" onClick={handleOpenCreateModal}>
              Cadastrar Primeiro Serviço
            </Button>
          }
        />
      ) : (
        <div className="card-grid">
          {services.map((service) => (
            <div key={service.id} className="item-card">
              <div className="item-card-header">
                <div className="item-card-title-group">
                  <div className="item-card-icon">
                    <ScissorsIcon size={20} />
                  </div>
                  <div>
                    <h3 className="item-card-title">{service.name}</h3>
                    <span className="item-card-badge">{service.active ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </div>
              </div>

              <div className="item-card-details">
                <div className="item-detail-row">
                  <span className="item-detail-label flex items-center gap-1">
                    <ClockIcon size={16} /> Duração:
                  </span>
                  <span className="item-detail-value tabular-nums">
                    {service.durationMinutes} minutos
                  </span>
                </div>
                <div className="item-detail-row">
                  <span className="item-detail-label flex items-center gap-1">
                    <DollarIcon size={16} /> Preço:
                  </span>
                  <span className="item-detail-value item-price tabular-nums">
                    {formatCurrency(service.priceInCents)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Cadastro de Serviço */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Novo Serviço">
        <form onSubmit={handleCreateService} className="modal-form">
          <Input
            label="Nome do Serviço"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Corte Masculino Artesanal"
          />

          <Input
            label="Duração (em minutos)"
            type="number"
            min="5"
            step="5"
            required
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            placeholder="Ex: 45"
            helperText="Tempo total necessário para a realização do atendimento."
          />

          <Input
            label="Preço em Reais (R$)"
            type="text"
            required
            value={priceInReais}
            onChange={(e) => setPriceInReais(e.target.value)}
            placeholder="Ex: 85,00"
            helperText="Digite o valor em reais (será convertido para centavos no envio)."
          />

          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Salvar Serviço
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
