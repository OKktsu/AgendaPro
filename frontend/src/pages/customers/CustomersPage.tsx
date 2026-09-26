import React, { useEffect, useState } from 'react';
import { customersApi } from '../../api/index.js';
import { Alert } from '../../components/common/Alert.js';
import { Button } from '../../components/common/Button.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { MailIcon, PhoneIcon, PlusIcon, UsersIcon } from '../../components/common/Icons.js';
import { Input } from '../../components/common/Input.js';
import { Modal } from '../../components/common/Modal.js';
import type { Customer } from '../../types/api.js';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Alerts
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const data = await customersApi.list();
      setCustomers(data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao carregar lista de clientes.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleOpenCreateModal = () => {
    setName('');
    setPhone('');
    setEmail('');
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (name.trim().length < 2) {
      setErrorMessage('O nome do cliente deve ter pelo menos 2 caracteres.');
      return;
    }

    if (phone.trim().length < 8) {
      setErrorMessage('O telefone deve ter pelo menos 8 dígitos.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await customersApi.create({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() ? email.trim() : null,
      });

      setCustomers((prev) => [...prev, created]);
      setSuccessMessage(`Cliente "${created.name}" cadastrado com sucesso!`);
      setIsModalOpen(false);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao cadastrar o cliente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getInitials = (custName: string) => {
    const parts = custName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">
            Base de clientes cadastrados para atendimentos e histórico de agendamentos.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2"
        >
          <PlusIcon size={18} />
          <span>Novo Cliente</span>
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
          <span>Carregando clientes...</span>
        </div>
      ) : customers.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={48} />}
          title="Nenhum cliente cadastrado"
          description="Cadastre clientes para vincular aos agendamentos e registrar seus atendimentos."
          action={
            <Button variant="primary" onClick={handleOpenCreateModal}>
              Cadastrar Primeiro Cliente
            </Button>
          }
        />
      ) : (
        <div className="card-grid">
          {customers.map((customer) => (
            <div key={customer.id} className="item-card">
              <div className="item-card-header">
                <div className="item-card-title-group">
                  <div className="customer-avatar">{getInitials(customer.name)}</div>
                  <div>
                    <h3 className="item-card-title">{customer.name}</h3>
                    <span className="customer-id-tag">Cliente Ativo</span>
                  </div>
                </div>
              </div>

              <div className="item-card-details">
                <div className="item-detail-row">
                  <span className="item-detail-label flex items-center gap-1">
                    <PhoneIcon size={16} /> Telefone:
                  </span>
                  <span className="item-detail-value tabular-nums">{customer.phone}</span>
                </div>
                {customer.email ? (
                  <div className="item-detail-row">
                    <span className="item-detail-label flex items-center gap-1">
                      <MailIcon size={16} /> E-mail:
                    </span>
                    <span className="item-detail-value truncate" title={customer.email}>
                      {customer.email}
                    </span>
                  </div>
                ) : (
                  <div className="item-detail-row">
                    <span className="item-detail-label flex items-center gap-1">
                      <MailIcon size={16} /> E-mail:
                    </span>
                    <span className="item-detail-value text-slate-400">Não informado</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Cadastro de Cliente */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Novo Cliente">
        <form onSubmit={handleCreateCustomer} className="modal-form">
          <Input
            label="Nome do Cliente"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Beatriz Mendes"
          />

          <Input
            label="Telefone / Celular"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ex: (11) 98452-1109"
            helperText="Número para contato e confirmação de agendamento."
          />

          <Input
            label="E-mail (opcional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ex: beatriz@exemplo.com"
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
              Salvar Cliente
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
