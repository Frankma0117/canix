import { useCallback, useEffect, useState } from 'react';
import { Bike, Check, MapPin, MessageSquare, PackageCheck, Phone, ShoppingBag, StickyNote, X } from 'lucide-react';
import { errMsg, useApi } from '../../../services/api.ts';
import type { OrderDetail } from '../../../types/store.ts';
import { money, ORDER_STATUS, paymentLabel, shortWhen } from '../../../utils/store.ts';
import { goTo } from '../../../utils/navigation.ts';
import { Drawer } from '../Modal.tsx';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Textarea } from '../../atoms/Input.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';
import { AuthedImage } from './StoreFrame.tsx';

const EVENT_LABEL: Record<string, string> = {
  placed: 'El cliente confirmó el pedido',
  proof_received: 'Llegó el comprobante',
  confirmed: 'Pedido confirmado',
  rejected: 'Pedido rechazado',
  shipped: 'Pedido enviado',
  delivered: 'Pedido entregado',
  cancelled: 'Pedido cancelado',
  payment_verified: 'Pago verificado',
  payment_rejected: 'Comprobante rechazado',
};

type Ask = { action: 'reject' | 'cancel' | 'payment'; title: string; hint: string; cta: string };

/** One order in full: what was asked, where it goes, how it is paid, and the next step. */
export function OrderDrawer({ storeId, orderId, onClose, onChanged }: { storeId: number; orderId: number; onClose: () => void; onChanged: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState('');
  const base = `/api/stores/${storeId}/orders/${orderId}`;

  const load = useCallback(async () => {
    try {
      setOrder(await api.get<OrderDetail>(base));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base]);
  useEffect(() => void load(), [load]);

  async function act(action: string, body: Record<string, unknown>, done: string) {
    setBusy(action);
    setError(null);
    try {
      setOrder(await api.post<OrderDetail>(`${base}/${action}`, body));
      toast.success(done);
      setAsk(null);
      setReason('');
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  const pickup = order?.delivery_type === 'pickup';
  const pay = order ? paymentLabel(order) : null;
  const canReviewPayment = order?.payment_method === 'transfer' && order.payment_status === 'proof_received' && (order.status === 'pending' || order.status === 'confirmed');

  const footer = order && !ask && (
    <div className="flex flex-wrap items-center gap-2">
      {order.status === 'pending' && (
        <>
          <Button loading={busy === 'confirm'} onClick={() => void act('confirm', {}, `Pedido ${order.label} confirmado. Ya le avisamos al cliente.`)}>
            <Check size={16} /> Confirmar pedido
          </Button>
          <Button variant="secondary" onClick={() => setAsk({ action: 'reject', title: 'Rechazar el pedido', hint: 'El cliente recibe este motivo por WhatsApp.', cta: 'Rechazar pedido' })}>
            <X size={16} /> Rechazar
          </Button>
        </>
      )}
      {order.status === 'confirmed' && (
        <Button loading={busy === 'ship'} onClick={() => void act('ship', {}, pickup ? `Le avisamos al cliente que ${order.label} está listo para recoger.` : `Pedido ${order.label} enviado. Ya le avisamos al cliente.`)}>
          {pickup ? <ShoppingBag size={16} /> : <Bike size={16} />} {pickup ? 'Listo para recoger' : 'Marcar como enviado'}
        </Button>
      )}
      {(order.status === 'shipped' || order.status === 'confirmed') && (
        <Button variant={order.status === 'shipped' ? 'primary' : 'secondary'} loading={busy === 'deliver'} onClick={() => void act('deliver', {}, `Pedido ${order.label} entregado.`)}>
          <PackageCheck size={16} /> Marcar como entregado
        </Button>
      )}
      {(order.status === 'confirmed' || order.status === 'shipped') && (
        <Button variant="ghost" onClick={() => setAsk({ action: 'cancel', title: 'Cancelar el pedido', hint: 'El cliente recibe este motivo por WhatsApp.', cta: 'Cancelar pedido' })}>
          Cancelar pedido
        </Button>
      )}
      <Button variant="ghost" className="ml-auto" onClick={() => goTo(`store-chats?c=${order.customer_id}`)}>
        <MessageSquare size={16} /> Ver conversación
      </Button>
    </div>
  );

  const askFooter = ask && order && (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink dark:text-white">{ask.title}</p>
      <Textarea rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" />
      <p className="mt-1.5 text-xs text-gray-dark">{ask.hint}</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          loading={busy === ask.action}
          onClick={() =>
            void act(ask.action, ask.action === 'payment' ? { status: 'rejected', reason } : { reason }, ask.action === 'payment' ? 'Le pedimos al cliente un comprobante válido.' : 'Listo. Ya le avisamos al cliente.')
          }
        >
          {ask.cta}
        </Button>
        <Button variant="ghost" onClick={() => setAsk(null)}>
          Volver
        </Button>
      </div>
    </div>
  );

  return (
    <Drawer
      title={order ? `Pedido ${order.label}` : 'Pedido'}
      subtitle={order && `${order.customer_name ?? order.recipient_name ?? 'Cliente'} · ${shortWhen(order.placed_at)}`}
      header={
        order && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
            {pay && <Badge tone={pay.tone}>{pay.label}</Badge>}
            {!!order.is_simulator && <Badge tone="cyan">Pedido de prueba</Badge>}
          </div>
        )
      }
      onClose={onClose}
      footer={askFooter || footer || undefined}
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!order ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          {order.status_reason && <Notice tone="info">Motivo: {order.status_reason}</Notice>}

          <section>
            <h3 className="mb-2 text-sm font-bold text-ink dark:text-white">Productos</h3>
            <ul className="divide-y divide-gray-medium/60 rounded-2xl border border-gray-medium/70 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-[var(--surface)]">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 min-w-8 rounded-lg bg-secondary px-1.5 py-0.5 text-center text-sm font-bold tabular-nums text-primary-dark dark:bg-primary/20 dark:text-white">{item.quantity}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink dark:text-white">{item.name}</p>
                    {item.notes && <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-300">{item.notes}</p>}
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p className="font-semibold text-ink dark:text-white">{money(item.unit_price * item.quantity)}</p>
                    {item.unit_price < item.list_price && <p className="text-xs text-gray-dark line-through">{money(item.list_price * item.quantity)}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 px-1 text-sm tabular-nums">
              <div className="flex justify-between text-gray-dark">
                <dt>Subtotal</dt>
                <dd>{money(order.subtotal)}</dd>
              </div>
              {order.delivery_type === 'delivery' && (
                <div className="flex justify-between text-gray-dark">
                  <dt>Domicilio</dt>
                  <dd>{order.delivery_fee ? money(order.delivery_fee) : 'Gratis'}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-ink dark:text-white">
                <dt>Total</dt>
                <dd>{money(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-ink dark:text-white">{pickup ? 'Recoge en el local' : 'Entrega a domicilio'}</h3>
            <div className="space-y-2 rounded-2xl border border-gray-medium/70 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-[var(--surface)]">
              {!pickup && (
                <p className="flex gap-2 text-ink dark:text-white">
                  <MapPin size={16} className="mt-0.5 shrink-0 text-primary" />
                  <span>
                    {order.address}
                    {order.address_reference && <span className="block text-gray-dark">{order.address_reference}</span>}
                  </span>
                </p>
              )}
              <p className="flex gap-2 text-ink dark:text-white">
                <Phone size={16} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  {order.recipient_name ?? 'Sin nombre'}
                  {order.phone && ` · ${order.phone}`}
                  {order.customer_phone && <span className="block text-gray-dark">WhatsApp +{order.customer_phone}</span>}
                </span>
              </p>
              {order.notes && (
                <p className="flex gap-2 text-ink dark:text-white">
                  <StickyNote size={16} className="mt-0.5 shrink-0 text-primary" />
                  <span>{order.notes}</span>
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-ink dark:text-white">Pago</h3>
            {order.payment_method === 'cash' ? (
              <p className="rounded-2xl border border-gray-medium/70 bg-white px-4 py-3 text-sm text-ink dark:border-white/10 dark:bg-[var(--surface)] dark:text-white">
                Paga <strong>{money(order.total)}</strong> en efectivo al recibir.
              </p>
            ) : !order.proof_url ? (
              <p className="rounded-2xl border border-dashed border-gray-medium bg-white px-4 py-3 text-sm text-gray-dark dark:border-white/15 dark:bg-[var(--surface)]">
                Transferencia. El cliente todavía no ha enviado el comprobante.
              </p>
            ) : (
              <div className="grid gap-4 rounded-2xl border border-gray-medium/70 bg-white p-4 sm:grid-cols-[160px_1fr] dark:border-white/10 dark:bg-[var(--surface)]">
                <AuthedImage src={order.proof_url} alt={`Comprobante del pedido ${order.label}`} className="h-52 w-full rounded-xl border border-gray-medium/70 object-cover object-top sm:w-40" />
                <div className="min-w-0 text-sm">
                  {order.proof?.amount != null ? (
                    <>
                      <p className="text-xs font-semibold text-gray-dark">Lectura automática del comprobante</p>
                      <p className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-white">{money(order.proof.amount)}</p>
                      <p className={`text-sm font-semibold ${order.proof.amountMatches ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                        {order.proof.amountMatches ? 'Coincide con el total del pedido' : `No coincide con el total (${money(order.total)})`}
                      </p>
                      <dl className="mt-3 space-y-1 text-gray-dark">
                        {[
                          ['Por', order.proof.bank],
                          ['Referencia', order.proof.reference],
                          ['Fecha', order.proof.date],
                          ['Envía', order.proof.payer],
                          ['Recibe', order.proof.recipient],
                        ]
                          .filter(([, v]) => v)
                          .map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                              <dt className="w-20 shrink-0">{k}</dt>
                              <dd className="min-w-0 break-words text-ink dark:text-white">{v}</dd>
                            </div>
                          ))}
                      </dl>
                    </>
                  ) : (
                    <p className="text-gray-dark">No se pudo leer el comprobante automáticamente. Ábrelo y revísalo.</p>
                  )}
                  <p className="mt-3 text-xs text-gray-dark">La lectura es una ayuda: confirma en tu banco que el dinero llegó.</p>
                  {canReviewPayment && !ask && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {order.status === 'confirmed' && (
                        <Button size="sm" variant="soft" loading={busy === 'payment'} onClick={() => void act('payment', { status: 'verified' }, 'Pago verificado.')}>
                          <Check size={14} /> Pago recibido
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAsk({ action: 'payment', title: 'Rechazar el comprobante', hint: 'Le pedimos al cliente que envíe uno válido, con este mensaje.', cta: 'Rechazar comprobante' })}
                      >
                        El comprobante no sirve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {order.status === 'pending' && order.payment_status === 'proof_received' && <p className="mt-2 px-1 text-xs text-gray-dark">Al confirmar el pedido, el pago queda como verificado.</p>}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-ink dark:text-white">Historial</h3>
            <ol className="space-y-2 px-1 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-gray-dark">{shortWhen(e.created_at)}</span>
                  <span className="text-ink dark:text-white">
                    {EVENT_LABEL[e.event] ?? e.event}
                    {e.actor_name && <span className="text-gray-dark"> · {e.actor_name}</span>}
                    {e.note && e.event !== 'placed' && <span className="block text-gray-dark">{e.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}
