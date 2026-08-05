import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'mi_agente_admin_token';

export interface PanelUser {
  id: number;
  name: string | null;
  role: 'admin' | 'user';
}

interface AuthContextValue {
  token: string | null;
  user: PanelUser | null;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
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

  const login = useCallback(async (candidate: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: candidate }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { user: PanelUser };
    sessionStorage.setItem(STORAGE_KEY, candidate);
    setToken(candidate);
    setUser(data.user);
    return true;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // A page reload keeps the token (sessionStorage) but not the in-memory `user` - re-learn who's
  // logged in via /api/auth/me instead of re-prompting for the token every time.
  useEffect(() => {
    if (!token || user) return;
    let cancelled = false;
    fetchMe(token).then((resolved) => {
      if (cancelled) return;
      if (resolved) setUser(resolved);
      else logout();
    });
    return () => {
      cancelled = true;
    };
  }, [token, user, logout]);

  const value = useMemo(() => ({ token, user, login, logout }), [token, user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
