import { useCallback, useMemo, useState } from 'react';
import { Bike, ShoppingBag } from 'lucide-react';
import { errMsg, useApi } from '../../services/api.ts';
import { usePolling } from '../../services/store.tsx';
import type { Order, OrdersResponse, OrderStatus, Store, StoreSummary } from '../../types/store.ts';
import { itemsLine, money, ORDER_STATUS, paymentLabel, shortWhen } from '../../utils/store.ts';
import { goTo } from '../../utils/navigation.ts';
import { StoreFrame } from '../../components/organisms/store/StoreFrame.tsx';
import { OrderDrawer } from '../../components/organisms/store/OrderDrawer.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Badge } from '../../components/atoms/Badge.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

type TabId = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'closed';
const TAB_STATUSES: Record<TabId, OrderStatus[]> = { pending: ['pending'], confirmed: ['confirmed'], shipped: ['shipped'], delivered: ['delivered'], closed: ['rejected', 'cancelled'] };
const EMPTY: Record<TabId, string> = {
  pending: 'Cuando un cliente confirme su pedido con el asistente, aparece aquí para que lo revises.',
  confirmed: 'Los pedidos que confirmes quedan aquí hasta que salgan.',
  shipped: 'Aquí ves los pedidos que van en camino.',
  delivered: 'Todavía no hay pedidos entregados.',
  closed: 'No hay pedidos rechazados ni cancelados.',
};

/**
 * Pedidos: what customers already confirmed with the assistant. A person of the business confirms
 * each one and marks it as sent; both steps notify the customer on WhatsApp.
 */
export function StoreOrdersPage() {
  return (
    <StoreFrame title="Pedidos" description="Los pedidos que tus clientes confirmaron por WhatsApp. Confírmalos y márcalos como enviados: el cliente recibe el aviso en cada paso.">
      {(store) => <Orders store={store} />}
    </StoreFrame>
  );
}

function Orders({ store }: { store: Store }) {
  const api = useApi();
  const toast = useToast();
  const [tab, setTab] = useState<TabId>('pending');
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [summary, setSummary] = useState<StoreSummary | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [orders, sum] = await Promise.all([api.get<OrdersResponse>(`/api/stores/${store.id}/orders`), api.get<StoreSummary>(`/api/stores/${store.id}/summary`)]);
      setData(orders);
      setSummary(sum);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, store.id]);
  usePolling(load, 10_000, [load]);

  const rows = useMemo(() => (data?.orders ?? []).filter((o) => TAB_STATUSES[tab].includes(o.status)), [data, tab]);
  const count = (t: TabId) => TAB_STATUSES[t].reduce((n, s) => n + (data?.counts[s] ?? 0), 0);

  async function quick(order: Order, action: 'confirm' | 'ship' | 'deliver', done: string) {
    setBusy(order.id);
    try {
      await api.post(`/api/stores/${store.id}/orders/${order.id}/${action}`);
      toast.success(done);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {!store.connection.connected && (
        <Notice tone="warning">
          El WhatsApp de este negocio no está conectado, así que los clientes no reciben los avisos.{' '}
          <button className="font-semibold underline underline-offset-2" onClick={() => goTo('store-whatsapp')}>
            Conectar el número
          </button>
        </Notice>
      )}

      {summary && (
        <p className="mb-4 text-sm text-gray-dark">
          Hoy: <strong className="tabular-nums text-ink dark:text-white">{money(summary.today.total)}</strong> en {summary.today.orders} {summary.today.orders === 1 ? 'pedido aceptado' : 'pedidos aceptados'} · Últimos 7 días:{' '}
          <strong className="tabular-nums text-ink dark:text-white">{money(summary.week.total)}</strong>
          {summary.humanChats > 0 && (
            <>
              {' · '}
              <button className="font-semibold text-primary underline underline-offset-2" onClick={() => goTo('store-chats')}>
                {summary.humanChats} {summary.humanChats === 1 ? 'cliente espera' : 'clientes esperan'} a una persona
              </button>
            </>
          )}
        </p>
      )}

      <Tabs
        tabs={[
          { id: 'pending', label: 'Por confirmar', count: count('pending') },
          { id: 'confirmed', label: 'Por enviar', count: count('confirmed') },
          { id: 'shipped', label: 'Enviados', count: count('shipped') },
          { id: 'delivered', label: 'Entregados', count: count('delivered') },
          { id: 'closed', label: 'Rechazados y cancelados', count: count('closed') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {!data ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShoppingBag size={36} className="text-primary" />} title="Nada por aquí" description={EMPTY[tab]} action={tab === 'pending' ? <Button variant="secondary" onClick={() => goTo('store-test')}>Hacer un pedido de prueba</Button> : undefined} />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
          {rows.map((order) => {
            const pay = paymentLabel(order);
            return (
              <li key={order.id} className="border-b border-gray-medium/60 last:border-b-0 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-gray-light/70 dark:hover:bg-white/5">
                  <button className="flex min-w-0 flex-1 basis-72 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25" onClick={() => setOpen(order.id)}>
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary-dark dark:bg-primary/20 dark:text-white" title={order.delivery_type === 'pickup' ? 'Recoge en el local' : 'A domicilio'}>
                      {order.delivery_type === 'pickup' ? <ShoppingBag size={17} /> : <Bike size={17} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-bold tabular-nums text-ink dark:text-white">{order.label}</span>
                        <span className="truncate text-sm font-semibold text-ink dark:text-white">{order.recipient_name ?? order.customer_name ?? 'Cliente'}</span>
                        <span className="text-xs tabular-nums text-gray-dark">{shortWhen(order.placed_at)}</span>
                        {!!order.is_simulator && <Badge tone="cyan">Prueba</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-gray-dark">{itemsLine(order)}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-dark">{order.delivery_type === 'pickup' ? 'Recoge en el local' : order.address}</span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {tab === 'closed' && <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>}
                    <Badge tone={pay.tone}>{pay.label}</Badge>
                    <span className="w-24 text-right font-bold tabular-nums text-ink dark:text-white">{money(order.total)}</span>
                    {order.status === 'pending' && (
                      <Button size="sm" onClick={() => setOpen(order.id)}>
                        Revisar
                      </Button>
                    )}
                    {order.status === 'confirmed' && (
                      <Button size="sm" loading={busy === order.id} onClick={() => void quick(order, 'ship', `Pedido ${order.label}: le avisamos al cliente.`)}>
                        {order.delivery_type === 'pickup' ? 'Listo para recoger' : 'Marcar enviado'}
                      </Button>
                    )}
                    {order.status === 'shipped' && (
                      <Button size="sm" variant="secondary" loading={busy === order.id} onClick={() => void quick(order, 'deliver', `Pedido ${order.label} entregado.`)}>
                        Entregado
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open !== null && <OrderDrawer storeId={store.id} orderId={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </>
  );
}
