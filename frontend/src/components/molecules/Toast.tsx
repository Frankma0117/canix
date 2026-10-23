import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

interface ToastItem {
  id: number;
  tone: 'success' | 'error';
  text: string;
}

interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Small corner notifications ("Permisos guardados") - replaces ad-hoc flash banners. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: ToastItem['tone'], text: string) => {
      const id = Date.now() + Math.random();
      setItems((all) => [...all.slice(-3), { id, tone, text }]);
      setTimeout(() => remove(id), tone === 'error' ? 6000 : 3500);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(() => ({ success: (t) => push('success', t), error: (t) => push('error', t) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-white px-4 py-3 text-sm shadow-lift animate-pop-in dark:bg-[#1a1f45] ${
              t.tone === 'success' ? 'border-success/30' : 'border-error/30'
            }`}
          >
            {t.tone === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" /> : <AlertCircle size={18} className="mt-0.5 shrink-0 text-error" />}
            <p className="flex-1 text-ink dark:text-white">{t.text}</p>
            <button onClick={() => remove(t.id)} className="text-gray-dark hover:text-ink dark:hover:text-white" aria-label="Cerrar">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
