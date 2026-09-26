import React from 'react';
import { MenuIcon } from '../common/Icons.js';
import { useAuth } from '../../context/useAuth.js';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  title?: string;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu, title }) => {
  const { user } = useAuth();

  const getInitials = (name?: string) => {
    if (!name) return 'AP';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <button
          type="button"
          className="header-mobile-toggle"
          onClick={onOpenMobileMenu}
          aria-label="Abrir menu de navegação"
        >
          <MenuIcon size={24} />
        </button>
        {title && <span className="header-title">{title}</span>}
      </div>

      <div className="header-right">
        <div className="header-user-profile">
          <div className="header-avatar" title={user?.name}>
            {getInitials(user?.name)}
          </div>
          <div className="header-user-info">
            <span className="header-user-name">{user?.name || 'Usuário'}</span>
            <span className="header-user-role">
              {user?.role === 'OWNER' ? 'Proprietário' : 'Equipe'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
