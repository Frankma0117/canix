import { ShieldCheck, Store as StoreIcon } from 'lucide-react';
import type { StoresState } from '../../../services/store.tsx';
import { useAuth } from '../../../services/auth.tsx';
import { goTo } from '../../../utils/navigation.ts';
import { BusinessPicker } from './BusinessPicker.tsx';

/**
 * Which business the Negocio module is showing. The owner sees their business; the Canix
 * administrator gets a picker and a "support" mark: they are looking at it as that business would.
 */
export function BusinessContext({ stores }: { stores: StoresState }) {
  const { user } = useAuth();
  const { data, store } = stores;
  if (!data || !store) return null;
  const support = user?.role === 'admin';

  return (
    <div className={`rounded-2xl border p-3 ${support ? 'border-amber-300/70 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-500/10' : 'border-gray-medium/60 bg-gray-light/70 dark:border-white/10 dark:bg-white/5'}`}>
      {support && (
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
          <ShieldCheck size={13} /> Modo soporte
        </p>
      )}
      {data.stores.length > 1 || support ? (
        <BusinessPicker stores={data.stores} selectedId={store.id} onSelect={stores.select} onManage={support ? () => goTo('admin-stores') : undefined} />
      ) : (
        <p className="flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
          <StoreIcon size={15} className="shrink-0 text-primary" aria-hidden />
          <span className="truncate">{store.name}</span>
        </p>
      )}
      {support && <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">Ves y operas este negocio como lo haría su administrador.</p>}
    </div>
  );
}
