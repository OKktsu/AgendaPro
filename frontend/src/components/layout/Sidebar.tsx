import React from 'react';
import { BadgeIcon, CalendarIcon, LogoutIcon, ScissorsIcon, UsersIcon } from '../common/Icons.js';
import { useAuth } from '../../context/useAuth.js';

export type NavTab = 'agenda' | 'customers' | 'services' | 'team';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  isOpenOnMobile?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  isOpenOnMobile = false,
  onCloseMobile,
}) => {
  const { user, logout } = useAuth();

  const handleNavClick = (tab: NavTab) => {
    onTabChange(tab);
    if (onCloseMobile) onCloseMobile();
  };

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: 'agenda', label: 'Agenda', icon: <CalendarIcon size={20} /> },
    { id: 'customers', label: 'Clientes', icon: <UsersIcon size={20} /> },
    { id: 'services', label: 'Serviços', icon: <ScissorsIcon size={20} /> },
    { id: 'team', label: 'Equipe', icon: <BadgeIcon size={20} /> },
  ];

  return (
    <>
      {isOpenOnMobile && (
        <div className="sidebar-mobile-backdrop" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside className={`app-sidebar ${isOpenOnMobile ? 'app-sidebar-mobile-open' : ''}`}>
        <div className="sidebar-top">
          {/* Logo & Brand */}
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">
              <CalendarIcon size={22} />
            </div>
            <span className="sidebar-brand-name">AgendaPro</span>
          </div>

          {/* Organization Unit Card */}
          <div className="sidebar-unit-card">
            <span className="sidebar-unit-label">Organização</span>
            <span className="sidebar-unit-name truncate" title={user?.organizationId}>
              {user?.role === 'OWNER' ? 'Proprietário' : 'Colaborador'}
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="sidebar-nav">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item-active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  <span className="sidebar-nav-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer with Logout */}
        <div className="sidebar-bottom">
          <button type="button" className="sidebar-nav-item sidebar-logout-btn" onClick={logout}>
            <span className="sidebar-nav-icon">
              <LogoutIcon size={20} />
            </span>
            <span className="sidebar-nav-label">Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
};
