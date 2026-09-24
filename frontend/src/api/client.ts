import type { ApiErrorResponse } from '../types/api.js';

export const TOKEN_STORAGE_KEY = 'agendapro_jwt_token';

export class ApiError extends Error {
  status: number;
  issues?: Record<string, string[]>;

  constructor(message: string, status: number, issues?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string') {
    return envUrl.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Silently ignore storage errors (e.g. incognito)
  }
}

export function clearToken(): void {
  setToken(null);
}

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${normalizedEndpoint}`;

  const headers = new Headers(options.headers || {});

  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError('Não foi possível conectar à API. Verifique se o servidor está ativo.', 0);
  }

  // Se a resposta estiver vazia (204 No Content)
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorBody = (data && typeof data === 'object' ? data : {}) as Partial<ApiErrorResponse>;
    const message =
      errorBody.message ||
      (typeof data === 'string' && data
        ? data
        : `Erro na requisição (Status HTTP ${response.status})`);

    throw new ApiError(message, response.status, errorBody.issues);
  }

  return data as T;
}
