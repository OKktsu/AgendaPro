import { createContext } from 'react';
import type {
  PasswordLoginResponse,
  OrganizationSelection,
  Organization,
  AuthRegisterResponse,
  GoogleLoginResponse,
  User,
} from '../types/api.js';

export interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  selection: OrganizationSelection | null;
  canSwitchOrganization: boolean;
  sessionVersion: number;
  selectOrganization: (id: string) => Promise<void>;
  beginOrganizationSwitch: () => Promise<void>;
  cancelSelection: () => void;
  login: (credentials: { email: string; password: string }) => Promise<PasswordLoginResponse>;
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
