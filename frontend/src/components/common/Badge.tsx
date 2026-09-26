import React from 'react';

export interface BadgeProps {
  variant?: 'scheduled' | 'cancelled' | 'in-progress' | 'neutral' | 'success' | 'info';
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  dot = false,
  className = '',
}) => {
  return (
    <span className={`badge badge-${variant} ${className}`.trim()}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
};
