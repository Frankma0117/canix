import { useCallback, useState } from 'react';
import { ArrowRight, Check, Circle, MessagesSquare, ShoppingBag, TrendingUp, UserRound } from 'lucide-react';
import { useApi } from '../../services/api.ts';
import { usePolling } from '../../services/store.tsx';
import type { Store, StoreSummary } from '../../types/store.ts';
import { goTo } from '../../utils/navigation.ts';
import { money } from '../../utils/store.ts';
import { StoreFrame } from '../../components/organisms/store/StoreFrame.tsx';
import { Badge } from '../../components/atoms/Badge.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

/** Resumen: the business at a glance, what needs a person now, and what is left to set up. */
export function StoreHomePage() {
  return (
    <StoreFrame title="Resumen" description="Cómo va el negocio hoy y qué necesita a una persona.">
      {(store) => <Overview store={store} />}
    </StoreFrame>
  );
}

function Overview({ store }: { store: Store }) {
  const api = useApi();
  const [summary, setSummary] = useState<StoreSummary | null>(null);
  const load = useCallback(async () => {
    try {
      setSummary(await api.get<StoreSummary>(`/api/stores/${store.id}/summary`));
    } catch {
      /* the cards just keep their last numbers */
    }
  }, [api, store.id]);
  usePolling(load, 20_000, [load]);

  const pending = summary?.counts.pending ?? store.pendingOrders;
  const waiting = summary?.humanChats ?? store.humanChats;

  const steps = [
    { done: store.products > 0, label: 'Carga tu catálogo', hint: 'Productos con precio y foto: es lo único que el asistente puede ofrecer.', to: 'store-products' },
    { done: !!(store.address || store.payment_info), label: 'Completa datos y pagos', hint: 'Dirección, medios de pago y costo de envío.', to: 'store-business' },
    { done: !!store.bot_enabled, label: 'Activa el asistente', hint: 'Define cómo atiende y enciéndelo.', to: 'store-attention' },
    { done: store.connection.connected, label: 'Vincula el WhatsApp del negocio', hint: 'Escanea el QR con el teléfono del negocio.', to: 'store-whatsapp' },
  ];
  const left = steps.filter((s) => !s.done);

  return (
    <div className="space-y-8">
      <section aria-label="Cifras" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<TrendingUp size={18} />} label="Ventas de hoy" value={summary ? money(summary.today.total) : null} sub={summary ? `${summary.today.orders} pedidos` : ''} onClick={() => goTo('store-orders')} />
        <Stat icon={<ShoppingBag size={18} />} label="Por confirmar" value={String(pending)} sub={pending ? 'Esperan a una persona' : 'Todo al día'} tone={pending ? 'warn' : undefined} onClick={() => goTo('store-orders')} />
        <Stat icon={<UserRound size={18} />} label="Esperan persona" value={String(waiting)} sub={waiting ? 'Clientes sin respuesta' : 'Nadie esperando'} tone={waiting ? 'warn' : undefined} onClick={() => goTo('store-chats')} />
        <Stat icon={<MessagesSquare size={18} />} label="Últimos 7 días" value={summary ? money(summary.week.total) : null} sub={summary ? `${summary.week.orders} pedidos` : ''} onClick={() => goTo('store-orders')} />
      </section>

      <section aria-label="WhatsApp" className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-medium/70 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-sm font-bold text-ink dark:text-white">WhatsApp del negocio</p>
          <p className="text-sm text-gray-dark">{store.connection.connected ? `Atendiendo desde +${store.connection.phone}` : store.connection.linked ? 'El número está vinculado pero desconectado.' : 'Todavía no hay un número vinculado: los clientes no pueden escribirte.'}</p>
        </div>
        <Badge tone={store.connection.connected ? 'success' : store.connection.linked ? 'warning' : 'neutral'}>{store.connection.connected ? 'Conectado' : store.connection.linked ? 'Desconectado' : 'Sin vincular'}</Badge>
        {!store.connection.connected && (
          <button onClick={() => goTo('store-whatsapp')} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {store.connection.linked ? 'Reconectar' : 'Vincular'} <ArrowRight size={14} />
          </button>
        )}
      </section>

      <section aria-label="Para dejarlo listo">
        <h2 className="mb-3 text-base font-extrabold text-ink dark:text-white">{left.length ? `Para dejarlo listo · ${steps.length - left.length} de ${steps.length}` : 'Todo está configurado'}</h2>
        <ol className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
          {steps.map((s) => (
            <li key={s.to} className="border-b border-gray-medium/60 last:border-b-0 dark:border-white/10">
              <button onClick={() => goTo(s.to)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-light/70 dark:hover:bg-white/5">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.done ? 'bg-success text-white' : 'text-gray-dark ring-1 ring-inset ring-gray-medium'}`}>{s.done ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-bold ${s.done ? 'text-gray-dark line-through' : 'text-ink dark:text-white'}`}>{s.label}</span>
                  {!s.done && <span className="block text-sm text-gray-dark">{s.hint}</span>}
                </span>
                <ArrowRight size={16} className="shrink-0 text-gray-dark" />
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Stat({ icon, label, value, sub, tone, onClick }: { icon: React.ReactNode; label: string; value: string | null; sub: string; tone?: 'warn'; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-gray-medium/70 bg-white p-4 text-left shadow-soft transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] dark:border-white/10 dark:bg-[var(--surface)]">
      <span className={`flex items-center gap-2 text-xs font-semibold ${tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-dark'}`}>
        {icon} {label}
      </span>
      {value === null ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-ink dark:text-white">{value}</p>}
      <p className="mt-0.5 text-xs text-gray-dark">{sub}</p>
    </button>
  );
}
