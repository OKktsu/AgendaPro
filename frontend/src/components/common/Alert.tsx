import React from 'react';
import { AlertCircleIcon, CheckIcon, CloseIcon } from './Icons.js';

export interface AlertProps {
  type?: 'error' | 'warning' | 'success' | 'info';
  title?: string;
  message: string;
  onClose?: () => void;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  type = 'info',
  title,
  message,
  onClose,
  className = '',
}) => {
  return (
    <div className={`alert alert-${type} ${className}`.trim()} role="alert">
      <div className="alert-icon">
        {type === 'success' ? <CheckIcon size={20} /> : <AlertCircleIcon size={20} />}
      </div>
      <div className="alert-content">
        {title && <h4 className="alert-title">{title}</h4>}
        <p className="alert-message">{message}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="alert-close-btn"
          onClick={onClose}
          aria-label="Fechar alerta"
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
};
