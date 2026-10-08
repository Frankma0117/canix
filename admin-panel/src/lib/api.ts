import { useMemo } from 'react';
import { useAuth } from './auth.tsx';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function buildApi(token: string | null, onUnauthorized: () => void, onMustChange: () => void) {
  async function handle<T>(res: Response): Promise<T> {
    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError('Tu sesión expiró, inicia sesión de nuevo.', 401);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (data.code === 'MUST_CHANGE_PASSWORD' || data.code === 'NO_PORTAL') onMustChange();
      throw new ApiError(data.error ?? `Error ${res.status}`, res.status, data.code);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let res: Response;
    try {
      res = await fetch(path, { ...options, headers });
    } catch {
      throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión.', 0);
    }
    return handle<T>(res);
  }

  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    put: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
    upload: <T,>(path: string, files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f, f.name));
      return request<T>(path, { method: 'POST', body: fd });
    },
    /** Fetches a protected file and returns a blob: URL to show/download it. */
    fileUrl: async (path: string) => {
      const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new ApiError('No se pudo abrir el archivo.', res.status);
      return URL.createObjectURL(await res.blob());
    },
  };
}

export type Api = ReturnType<typeof buildApi>;

export function useApi(): Api {
  const { token, logout, refresh } = useAuth();
  return useMemo(() => buildApi(token, logout, () => void refresh()), [token, logout, refresh]);
}

/** Message from any thrown value - for showing errors in the UI. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
}
