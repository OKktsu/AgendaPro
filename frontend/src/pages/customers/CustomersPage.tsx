import React, { useCallback, useEffect, useState } from 'react';
import { customersApi } from '../../api/index.js';
import { Alert } from '../../components/common/Alert.js';
import { Button } from '../../components/common/Button.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import {
  CloseIcon,
  EditIcon,
  MailIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from '../../components/common/Icons.js';
import { Input } from '../../components/common/Input.js';
import { Modal } from '../../components/common/Modal.js';
import type { Customer } from '../../types/api.js';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Edit modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');

  // Alerts
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadCustomers = useCallback(async (search?: string) => {
    setIsLoading(true);
    try {
      const data = await customersApi.list(search);
      setCustomers(data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao carregar lista de clientes.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadCustomers(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, loadCustomers]);

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

  const handleOpenEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditEmail(customer.email || '');
    setErrorMessage(null);
    setIsEditModalOpen(true);
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    setErrorMessage(null);

    if (editName.trim().length < 2) {
      setErrorMessage('O nome do cliente deve ter pelo menos 2 caracteres.');
      return;
    }

    if (editPhone.trim().length < 8) {
      setErrorMessage('O telefone deve ter pelo menos 8 dígitos.');
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const updated = await customersApi.update(editingCustomer.id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim() ? editEmail.trim() : null,
      });

      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSuccessMessage(`Cliente "${updated.name}" atualizado com sucesso!`);
      setIsEditModalOpen(false);
      setEditingCustomer(null);
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Falha ao atualizar o cliente.');
    } finally {
      setIsSubmittingEdit(false);
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

      {/* Barra de Busca */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="search-input-wrapper">
          <SearchIcon size={18} className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="search-input-field"
            aria-label="Buscar clientes"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="search-clear-btn"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              <CloseIcon size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="loading-state">
          <div className="btn-spinner" style={{ width: 32, height: 32 }} />
          <span>Carregando clientes...</span>
        </div>
      ) : customers.length === 0 ? (
        searchQuery.trim() ? (
          <EmptyState
            icon={<UsersIcon size={48} />}
            title="Nenhum cliente encontrado"
            description={`Não encontramos nenhum cliente correspondente a "${searchQuery.trim()}".`}
            action={
              <Button variant="secondary" onClick={() => setSearchQuery('')}>
                Limpar Busca
              </Button>
            }
          />
        ) : (
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
        )
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
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenEditModal(customer)}
                  className="flex items-center gap-1.5"
                  title={`Editar ${customer.name}`}
                >
                  <EditIcon size={14} />
                  <span>Editar</span>
                </Button>
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
            disabled={isSubmitting}
          />

          <Input
            label="Telefone / Celular"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ex: (11) 98452-1109"
            helperText="Número para contato e confirmação de agendamento."
            disabled={isSubmitting}
          />

          <Input
            label="E-mail (opcional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ex: beatriz@exemplo.com"
            disabled={isSubmitting}
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

      {/* Modal Edição de Cliente */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          if (!isSubmittingEdit) {
            setIsEditModalOpen(false);
            setEditingCustomer(null);
          }
        }}
        title="Editar Cliente"
      >
        <form onSubmit={handleUpdateCustomer} className="modal-form">
          <Input
            label="Nome do Cliente"
            type="text"
            required
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Ex: Beatriz Mendes"
            disabled={isSubmittingEdit}
          />

          <Input
            label="Telefone / Celular"
            type="tel"
            required
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            placeholder="Ex: (11) 98452-1109"
            helperText="Número para contato e confirmação de agendamento."
            disabled={isSubmittingEdit}
          />

          <Input
            label="E-mail (opcional)"
            type="email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="Ex: beatriz@exemplo.com"
            disabled={isSubmittingEdit}
          />

          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsEditModalOpen(false);
                setEditingCustomer(null);
              }}
              disabled={isSubmittingEdit}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmittingEdit}>
              Salvar Alterações
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
