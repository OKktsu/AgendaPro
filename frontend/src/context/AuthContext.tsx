import React, { useEffect, useState } from 'react';
import { authApi, clearToken, getToken, setToken } from '../api/index.js';
import type { User } from '../types/api.js';
import { AuthContext } from './AuthContextDefinition.js';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [tokenState, setTokenState] = useState<string | null>(() => getToken());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSession() {
      const storedToken = getToken();
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await authApi.getMe();
        setUser(response.user);
        setTokenState(storedToken);
      } catch (error) {
        console.error('Falha ao validar sessão salva:', error);
        clearToken();
        setUser(null);
        setTokenState(null);
      } finally {
        setIsLoading(false);
      }
    }

    loadSession();
  }, []);

  const login = async (credentials: { email: string; password: string }) => {
    const result = await authApi.login(credentials);
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
    return result;
  };

  const register = async (data: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
  }) => {
    const result = await authApi.register(data);
    return result;
  };

  const logout = () => {
    clearToken();
    setUser(null);
    setTokenState(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token: tokenState,
        isLoading,
        isAuthenticated: !!user && !!tokenState,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
