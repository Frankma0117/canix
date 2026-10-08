import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Session token lives in sessionStorage: closing the browser tab/window ends the session on this
// device (the server also expires it - 24h idle, 7 days max).
const STORAGE_KEY = 'canix_session';

export interface PanelUser {
  id: number;
  name: string | null;
  phone: string;
  /** false = WhatsApp hasn't shared the real number yet; `phone` is then their access code. */
  phoneKnown?: boolean;
  role: 'admin' | 'user';
  permissions: string[];
  modules: string[];
  mustChangePassword: boolean;
  hasPassword: boolean;
}

interface AuthContextValue {
  token: string | null;
  user: PanelUser | null;
  loading: boolean;
  /** Number + password. Returns an error message, or null on success. */
  login: (phone: string, password: string) => Promise<string | null>;
  /** Admin bootstrap only: the old admin token, while no password exists yet. */
  loginWithToken: (token: string) => Promise<string | null>;
  logout: () => void;
  /** Re-reads /api/auth/me (after a password change, permission change...). */
  refresh: () => Promise<void>;
  replaceToken: (token: string) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(token: string): Promise<PanelUser | null> {
  const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json()) as PanelUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState<PanelUser | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !!sessionStorage.getItem(STORAGE_KEY));

  const store = useCallback((t: string | null) => {
    if (t) sessionStorage.setItem(STORAGE_KEY, t);
    else sessionStorage.removeItem(STORAGE_KEY);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    const t = sessionStorage.getItem(STORAGE_KEY);
    if (t) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
    store(null);
    setUser(null);
  }, [store]);

  const login = useCallback(
    async (phone: string, password: string) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return (data as { error?: string }).error ?? 'No se pudo iniciar sesión.';
        store((data as { token: string }).token);
        setUser((data as { user: PanelUser }).user);
        return null;
      } catch {
        return 'No se pudo conectar con el servidor.';
      }
    },
    [store],
  );

  const loginWithToken = useCallback(
    async (candidate: string) => {
      const me = await fetchMe(candidate).catch(() => null);
      if (!me) return 'Token inválido, o el administrador ya tiene contraseña (entra con número y contraseña).';
      store(candidate);
      setUser(me);
      return null;
    },
    [store],
  );

  const refresh = useCallback(async () => {
    const t = sessionStorage.getItem(STORAGE_KEY);
    if (!t) return;
    const me = await fetchMe(t).catch(() => null);
    if (me) setUser(me);
    else logout();
  }, [logout]);

  // After a reload only the token survives - re-learn who's logged in.
  useEffect(() => {
    if (!token || user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchMe(token)
      .then((me) => {
        if (cancelled) return;
        if (me) setUser(me);
        else logout();
      })
      .catch(() => !cancelled && logout())
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token, user, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      login,
      loginWithToken,
      logout,
      refresh,
      replaceToken: store,
      can: (p: string) => !!user && (user.role === 'admin' || user.permissions.includes(p)),
    }),
    [token, user, loading, login, loginWithToken, logout, refresh, store],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
