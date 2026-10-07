import { useEffect, useRef, type FC } from 'react';

type GoogleCredentialResponse = { credential?: string };
type GoogleButtonOptions = {
  theme: 'outline';
  size: 'large';
  text: 'continue_with';
  shape: 'rectangular';
  width: string;
};
type GoogleIdentityApi = {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (element: HTMLElement, options: GoogleButtonOptions) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export const GoogleSignInButton: FC<{
  disabled?: boolean;
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
}> = ({ disabled = false, onCredential, onError }) => {
  const buttonRef = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;

    let active = true;
    const renderButton = () => {
      if (!active || !buttonRef.current || !window.google) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!response.credential) {
            onError('O Google não retornou uma credencial válida.');
            return;
          }
          void onCredential(response.credential).catch(() => {
            onError('Não foi possível entrar com o Google. Tente novamente.');
          });
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: String(Math.min(buttonRef.current.clientWidth || 360, 360)),
      });
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT_URL}"]`);
    if (window.google) {
      renderButton();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.src = GOOGLE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.append(script);
      }
      script.addEventListener('load', renderButton);
      script.addEventListener('error', () => {
        if (active) onError('Não foi possível carregar o login do Google.');
      });
    }

    return () => {
      active = false;
    };
  }, [clientId, onCredential, onError]);

  if (!clientId) {
    return (
      <p className="google-sign-in-note">
        Para ativar o login Google, configure <code>VITE_GOOGLE_CLIENT_ID</code> no frontend.
      </p>
    );
  }

  return (
    <div className={`google-sign-in ${disabled ? 'google-sign-in-disabled' : ''}`}>
      <div ref={buttonRef} />
      {disabled && <div className="google-sign-in-overlay" aria-hidden="true" />}
    </div>
  );
};
