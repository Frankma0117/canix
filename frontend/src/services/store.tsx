import { useCallback, useEffect, useState } from 'react';
import { errMsg, useApi } from './api.ts';
import type { Store, StoresResponse } from '../types/store.ts';

const STORAGE_KEY = 'canix_store';

/** The store being managed is remembered per browser, and shared by every "Pedidos" section. */
export function rememberStore(id: number) {
  localStorage.setItem(STORAGE_KEY, String(id));
  // Sidebar and the open section are separate hook instances: let them follow the change.
  window.dispatchEvent(new CustomEvent('canix-store', { detail: id }));
}

export interface StoresState {
  data: StoresResponse | null;
  store: Store | null;
  error: string | null;
  select: (id: number) => void;
  reload: () => Promise<void>;
}

/** The businesses the signed-in person manages, and which one they're looking at. */
export function useStores(enabled = true): StoresState {
  const api = useApi();
  const [data, setData] = useState<StoresResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number>(() => Number(localStorage.getItem(STORAGE_KEY)) || 0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await api.get<StoresResponse>('/api/stores'));
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, enabled]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    const onChange = (e: Event) => setSelected(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener('canix-store', onChange);
    return () => window.removeEventListener('canix-store', onChange);
  }, []);

  const select = useCallback((id: number) => {
    rememberStore(id);
    setSelected(id);
  }, []);

  const store = data ? (data.stores.find((s) => s.id === selected) ?? data.stores[0] ?? null) : null;
  return { data, store, error, select, reload };
}

/** Runs `tick` now and every `ms` while the tab is visible. */
export function usePolling(tick: () => void | Promise<void>, ms: number, deps: unknown[]) {
  useEffect(() => {
    let active = true;
    const run = () => {
      if (active && !document.hidden) void tick();
    };
    run();
    const timer = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
