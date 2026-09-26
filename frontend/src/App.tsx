import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext.js';
import { useAuth } from './context/useAuth.js';
import { AppLayout } from './components/layout/AppLayout.js';
import type { NavTab } from './components/layout/Sidebar.js';
import { AuthPage } from './pages/auth/AuthPage.js';
import { AgendaPage } from './pages/agenda/AgendaPage.js';
import { CustomersPage } from './pages/customers/CustomersPage.js';
import { ServicesPage } from './pages/services/ServicesPage.js';
import { TeamPage } from './pages/team/TeamPage.js';

const MainRouter: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('agenda');

  if (isLoading) {
    return (
      <div className="auth-container">
        <div className="loading-state">
          <div className="btn-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>Carregando AgendaPro...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return (
    <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'agenda' && <AgendaPage />}
      {activeTab === 'customers' && <CustomersPage />}
      {activeTab === 'services' && <ServicesPage />}
      {activeTab === 'team' && <TeamPage />}
    </AppLayout>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainRouter />
    </AuthProvider>
  );
};
