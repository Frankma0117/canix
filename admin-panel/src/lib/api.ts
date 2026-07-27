import { useMemo } from 'react';
import { useAuth } from './auth.tsx';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function buildApi(token: string | null, onUnauthorized: () => void) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body) headers.set('Content-Type', 'application/json');

    const res = await fetch(path, { ...options, headers });

    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError('Sesion expirada, vuelve a ingresar el token', 401);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      throw new ApiError(data.error ?? `Error ${res.status}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    put: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

export type Api = ReturnType<typeof buildApi>;

export function useApi(): Api {
  const { token, logout } = useAuth();
  return useMemo(() => buildApi(token, logout), [token, logout]);
}
