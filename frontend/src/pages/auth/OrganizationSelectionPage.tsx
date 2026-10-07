import { useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import { Button } from '../../components/common/Button.js';
import { Alert } from '../../components/common/Alert.js';

export function OrganizationSelectionPage() {
  const { selection, selectOrganization, cancelSelection } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function choose(id: string) {
    if (pending) return;
    setPending(id);
    setError(null);
    try {
      await selectOrganization(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar nesta empresa.');
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="auth-container">
      <section className="auth-card" aria-labelledby="organization-choice-title">
        <h1 id="organization-choice-title">Escolha sua empresa</h1>
        <p className="mb-4">
          Selecione o espaço que deseja acessar. A escolha expira em cinco minutos.
        </p>
        {error && <Alert type="error" message={error} className="mb-4" />}
        <div className="auth-form">
          {selection?.organizations.map((org) => (
            <Button
              key={org.id}
              variant="secondary"
              disabled={!!pending}
              isLoading={pending === org.id}
              onClick={() => void choose(org.id)}
            >
              {org.name} — {org.role === 'OWNER' ? 'Proprietário' : 'Equipe'}
            </Button>
          ))}
          <Button variant="ghost" onClick={cancelSelection}>
            Voltar ao login
          </Button>
        </div>
      </section>
    </div>
  );
}
