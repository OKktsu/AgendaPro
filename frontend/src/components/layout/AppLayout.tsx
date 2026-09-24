import React, { useState } from 'react';
import { Header } from './Header.js';
import { type NavTab, Sidebar } from './Sidebar.js';

interface AppLayoutProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ activeTab, onTabChange, children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const getPageTitle = (tab: NavTab) => {
    switch (tab) {
      case 'agenda':
        return 'Agenda Diária';
      case 'customers':
        return 'Gestão de Clientes';
      case 'services':
        return 'Catálogo de Serviços';
      case 'team':
        return 'Equipe & Expediente';
      default:
        return 'AgendaPro';
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        isOpenOnMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />
      <div className="app-main-wrapper">
        <Header
          title={getPageTitle(activeTab)}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
        />
        <main className="app-main-content">{children}</main>
      </div>
    </div>
  );
};
