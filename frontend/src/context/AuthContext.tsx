import React, { useEffect, useRef, useState } from 'react';
import { authApi, clearToken, getToken, setToken, TOKEN_STORAGE_KEY } from '../api/index.js';
import type { AuthLoginResponse, Organization, OrganizationSelection, User } from '../types/api.js';
import { AuthContext } from './AuthContextDefinition.js';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [tokenState, setTokenState] = useState<string | null>(() => getToken());
  const [isLoading, setIsLoading] = useState(true);
  const [selection, setSelection] = useState<OrganizationSelection | null>(null);
  const [canSwitchOrganization, setCanSwitchOrganization] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const epoch = useRef(0);

  useEffect(() => {
    const changedElsewhere = (event: StorageEvent) => {
      if (event.key !== TOKEN_STORAGE_KEY && event.key !== null) return;
      ++epoch.current;
      // Outra aba não pode carregar dados com um token novo e manter o perfil antigo.
      setUser(null);
      setOrganization(null);
      setTokenState(null);
      setSelection(null);
      setCanSwitchOrganization(false);
      setSessionVersion((value) => value + 1);
      setIsLoading(false);
    };
    window.addEventListener('storage', changedElsewhere);
    return () => window.removeEventListener('storage', changedElsewhere);
  }, []);

  const acceptSession = (result: AuthLoginResponse) => {
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
    setOrganization(result.organization ?? null);
    setSelection(null);
    setCanSwitchOrganization(result.canSwitchOrganization ?? false);
    setSessionVersion((value) => value + 1);
  };
  const clearSession = () => {
    clearToken();
    setUser(null);
    setOrganization(null);
    setTokenState(null);
    setCanSwitchOrganization(false);
    setSessionVersion((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    const attempt = epoch.current;
    async function loadSession() {
      const storedToken = getToken();
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await authApi.getMe();
        if (!active || epoch.current !== attempt) return;
        setUser(response.user);
        setOrganization(response.organization ?? null);
        setCanSwitchOrganization(response.canSwitchOrganization ?? false);
        setTokenState(storedToken);
      } catch (error) {
        if (!active || epoch.current !== attempt) return;
        console.error('Falha ao validar sessão salva:', error);
        clearToken();
        setUser(null);
        setTokenState(null);
      } finally {
        if (active && epoch.current === attempt) setIsLoading(false);
      }
    }

    loadSession();
    return () => {
      active = false;
    };
  }, []);

  const login = async (credentials: { email: string; password: string }) => {
    const attempt = ++epoch.current;
    const result = await authApi.login(credentials);
    if (attempt !== epoch.current) throw new Error('Operação de login cancelada.');
    if ('status' in result) {
      clearSession();
      setSelection(result);
    } else acceptSession(result);
    return result;
  };

  const loginWithGoogle = async (credential: string) => {
    const attempt = ++epoch.current;
    const result = await authApi.loginWithGoogle(credential);
    if (attempt !== epoch.current) throw new Error('Operação de login cancelada.');
    if ('status' in result) {
      if (result.status === 'organization_selection_required') {
        clearSession();
        setSelection(result);
      }
      return result;
    }
    acceptSession(result);
    return result;
  };

  const register = async (data: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
    googleCredential?: string;
  }) => {
    const attempt = ++epoch.current;
    const result = await authApi.register(data);
    if (attempt !== epoch.current) throw new Error('Cadastro cancelado.');
    if (result.token) {
      acceptSession({ ...result, token: result.token });
    }
    return result;
  };

  const logout = () => {
    ++epoch.current;
    clearSession();
    setSelection(null);
  };

  const beginOrganizationSwitch = async () => {
    const attempt = ++epoch.current;
    const result = await authApi.listOrganizations();
    if (attempt !== epoch.current) return;
    clearSession();
    setSelection(result);
  };
  const selectOrganization = async (id: string) => {
    if (!selection) throw new Error('Entre novamente para escolher uma empresa.');
    const attempt = ++epoch.current;
    const result = await authApi.selectOrganization(selection.selectionToken, id);
    if (attempt !== epoch.current) throw new Error('Seleção cancelada.');
    acceptSession(result);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        token: tokenState,
        isLoading,
        isAuthenticated: !!user && !!tokenState,
        selection,
        canSwitchOrganization,
        sessionVersion,
        selectOrganization,
        beginOrganizationSwitch,
        cancelSelection: logout,
        login,
        loginWithGoogle,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
