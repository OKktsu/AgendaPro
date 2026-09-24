import React, { useState } from 'react';
import { Alert } from '../../components/common/Alert.js';
import { Button } from '../../components/common/Button.js';
import { CalendarIcon } from '../../components/common/Icons.js';
import { Input } from '../../components/common/Input.js';
import { useAuth } from '../../context/useAuth.js';

export const AuthPage: React.FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');

  // Status states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      await login({ email, password });
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao realizar login. Verifique suas credenciais.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (password.length < 8) {
      setErrorMessage('A senha deve conter no mínimo 8 caracteres.');
      return;
    }

    setIsLoading(true);

    try {
      await register({
        organizationName,
        name,
        email,
        password,
      });

      setSuccessMessage('Empresa cadastrada com sucesso! Entre com sua senha para começar.');
      setMode('login');
      setPassword('');
    } catch (err: unknown) {
      const error = err as { message?: string };
      setErrorMessage(error.message || 'Erro ao cadastrar empresa.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Brand Header */}
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <CalendarIcon size={28} />
          </div>
          <h1 className="auth-brand-title">AgendaPro</h1>
          <p className="auth-brand-subtitle">
            Sistema de agendamento e gestão para negócios de serviços
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'auth-tab-active' : ''}`}
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
            }}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab ${mode === 'register' ? 'auth-tab-active' : ''}`}
            onClick={() => {
              setMode('register');
              setErrorMessage(null);
            }}
          >
            Cadastrar Empresa
          </button>
        </div>

        {/* Feedback Alerts */}
        {errorMessage && (
          <Alert
            type="error"
            message={errorMessage}
            onClose={() => setErrorMessage(null)}
            className="mb-4"
          />
        )}
        {successMessage && (
          <Alert
            type="success"
            message={successMessage}
            onClose={() => setSuccessMessage(null)}
            className="mb-4"
          />
        )}

        {/* Form Body */}
        {mode === 'login' ? (
          <form onSubmit={handleLoginSubmit} className="auth-form">
            <Input
              label="E-mail"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
            />
            <Input
              label="Senha"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Acessar Sistema
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="auth-form">
            <Input
              label="Nome da Empresa / Estabelecimento"
              type="text"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Ex: Studio Bella Arte"
            />
            <Input
              label="Seu Nome Completo (Administrador)"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Dra. Marcela Dias"
            />
            <Input
              label="E-mail Corporativo"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@studiobella.com"
            />
            <Input
              label="Senha de Acesso (mínimo 8 caracteres)"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              helperText="Mínimo de 8 caracteres"
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Criar Conta e Começar
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};
