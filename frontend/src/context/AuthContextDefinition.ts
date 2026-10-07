import { createContext } from 'react';
import type {
  AuthLoginResponse,
  AuthRegisterResponse,
  GoogleLoginResponse,
  User,
} from '../types/api.js';

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string }) => Promise<AuthLoginResponse>;
  loginWithGoogle: (credential: string) => Promise<GoogleLoginResponse>;
  register: (data: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
    googleCredential?: string;
  }) => Promise<AuthRegisterResponse>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
