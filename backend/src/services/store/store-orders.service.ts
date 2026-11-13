import { db } from '../../database/connection.js';
import { storeCustomersModel, storeOrdersModel, storesModel, type OrderListRow } from '../../models/store.model.js';
import { nowLocal } from '../../shared/utils/datetime.js';
import { deliveryFeeFor, money, pricedProduct } from './store-pricing.js';
import { internalNote, notifyMembers, sendToCustomer } from './store-outbox.js';
import type { DeliveryType, PaymentMethod, PaymentProofReading, Store, StoreCustomer, StoreOrder, StoreOrderItem } from '../../entities/index.js';

/**
 * The order of a customer, from cart to delivery.
 *
 *   draft ──(customer confirms)──► pending ──(business confirms)──► confirmed ──► shipped ──► delivered
 *                                     │ └──(business rejects)──► rejected
 *                                     └──(customer or business cancels)──► cancelled
 *
 * The assistant only ever builds the cart and places the order (draft -> pending). Everything
 * after that is decided by a real person of the business, from the portal or by reacting to the
 * WhatsApp notice - and each step tells the customer ("tu pedido ha sido confirmado / enviado").
 *
 * Prices never come from the model: items are priced here, from the catalog and today's promotions.
 */
export class StoreError extends Error {}

export interface OrderView extends StoreOrder {
  items: StoreOrderItem[];
  proof: PaymentProofReading | null;
}

export function orderLabel(order: Pick<StoreOrder, 'number' | 'id'>): string {
  return `#${order.number ?? order.id}`;
}

function parseProof(raw: string | null): PaymentProofReading | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PaymentProofReading;
  } catch {
    return null;
  }
}

export function orderView(order: StoreOrder): OrderView {
  return { ...order, items: storeOrdersModel.items(order.id), proof: parseProof(order.proof_data) };
}

// ------------------------------------------------------------------ cart (draft)

/** The customer's cart, created on demand. */
function draftFor(store: Store, customer: StoreCustomer): StoreOrder {
  return storeOrdersModel.draftOf(customer.id) ?? storeOrdersModel.createDraft(store.id, customer.id);
}

/**
 * Re-prices the cart with today's catalog (a promotion that started or ended, a price edited, a
 * product that ran out since it was added) and recomputes its totals. Returns what was dropped.
 */
function refreshDraft(store: Store, order: StoreOrder): string[] {
  const dropped: string[] = [];
  for (const item of storeOrdersModel.items(order.id)) {
    const product = item.product_id ? pricedProduct(store.id, item.product_id) : undefined;
    if (!product || !product.available) {
      storeOrdersModel.removeItem(item.id);
      dropped.push(item.name);
    } else if (product.current_price !== item.unit_price || product.price !== item.list_price || product.name !== item.name) {
      storeOrdersModel.updateItem(item.id, { unit_price: product.current_price, list_price: product.price, name: product.name });
    }
  }
  const subtotal = storeOrdersModel.items(order.id).reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const fee = order.delivery_type === 'delivery' && subtotal > 0 ? deliveryFeeFor(store, subtotal) : 0;
  storeOrdersModel.update(order.id, { subtotal, delivery_fee: fee, total: subtotal + fee });
  return dropped;
}

export interface CartState {
  order: OrderView;
  /** Products that were in the cart and are no longer available. */
  dropped: string[];
  /** What is still needed before the order can be placed, in plain words. */
  missing: string[];
}

export function cartOf(store: Store, customer: StoreCustomer): CartState | null {
  const draft = storeOrdersModel.draftOf(customer.id);
  if (!draft) return null;
  const dropped = refreshDraft(store, draft);
  const order = orderView(storeOrdersModel.get(store.id, draft.id)!);
  return { order, dropped, missing: missingToPlace(store, order) };
}

function missingToPlace(store: Store, order: OrderView): string[] {
  const missing: string[] = [];
  if (!order.items.length) missing.push('agregar al menos un producto');
  if (order.items.length && store.min_order > 0 && order.subtotal < store.min_order) missing.push(`llegar al pedido mínimo de ${money(store.min_order)} (va en ${money(order.subtotal)})`);
  if (!order.delivery_type) missing.push(store.allows_pickup ? 'saber si es a domicilio o para recoger' : 'los datos de entrega a domicilio');
  if (!order.recipient_name) missing.push('el nombre de quien recibe');
  if (order.delivery_type === 'delivery') {
    if (!order.address) missing.push('la dirección de entrega');
    if (!order.phone) missing.push('un teléfono de contacto');
  }
  if (!order.payment_method) missing.push('el método de pago');
  return missing;
}

export function addToCart(store: Store, customer: StoreCustomer, items: { productId: number; quantity: number; notes?: string | null }[]): { added: string[]; errors: string[] } {
  const draft = draftFor(store, customer);
  const added: string[] = [];
  const errors: string[] = [];
  for (const wanted of items) {
    const product = pricedProduct(store.id, wanted.productId);
    const quantity = Math.trunc(Number(wanted.quantity));
    if (!product) errors.push(`No existe un producto con id ${wanted.productId}: búscalo en el catálogo antes de agregarlo.`);
    else if (!product.available) errors.push(`"${product.name}" está agotado hoy.`);
    else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) errors.push(`Cantidad inválida para "${product.name}".`);
    else {
      const notes = wanted.notes?.trim() || null;
      const same = storeOrdersModel.items(draft.id).find((i) => i.product_id === product.id && (i.notes ?? null) === notes);
      if (same) storeOrdersModel.updateItem(same.id, { quantity: Math.min(999, same.quantity + quantity) });
      else storeOrdersModel.addItem(draft.id, { product_id: product.id, name: product.name, unit_price: product.current_price, list_price: product.price, quantity, notes });
      added.push(`${quantity} × ${product.name}`);
    }
  }
  refreshDraft(store, draft);
  return { added, errors };
}

/** Changes one line of the cart; quantity 0 removes it. */
export function updateCartLine(store: Store, customer: StoreCustomer, lineId: number, patch: { quantity?: number; notes?: string | null }): void {
  const draft = storeOrdersModel.draftOf(customer.id);
  const line = draft && storeOrdersModel.items(draft.id).find((i) => i.id === lineId);
  if (!draft || !line) throw new StoreError('Esa línea no está en el pedido actual. Revisa el pedido antes de cambiarlo.');
  if (patch.quantity !== undefined) {
    const quantity = Math.trunc(Number(patch.quantity));
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) throw new StoreError('Cantidad inválida.');
    if (quantity === 0) storeOrdersModel.removeItem(line.id);
    else storeOrdersModel.updateItem(line.id, { quantity });
  }
  if (patch.notes !== undefined && patch.quantity !== 0) storeOrdersModel.updateItem(line.id, { notes: patch.notes?.trim() || null });
  refreshDraft(store, draft);
}

export function clearCart(store: Store, customer: StoreCustomer): void {
  const draft = storeOrdersModel.draftOf(customer.id);
  if (!draft) return;
  storeOrdersModel.clearItems(draft.id);
  refreshDraft(store, draft);
}

export interface DeliveryInput {
  deliveryType?: DeliveryType;
  recipientName?: string;
  phone?: string;
  address?: string;
  addressReference?: string;
  notes?: string;
}

export function setDelivery(store: Store, customer: StoreCustomer, input: DeliveryInput): void {
  const draft = draftFor(store, customer);
  if (input.deliveryType === 'pickup' && !store.allows_pickup) throw new StoreError('Este negocio solo entrega a domicilio, no tiene recogida en el local.');
  const clean = (v: string | undefined, max: number) => (v === undefined ? undefined : v.trim().slice(0, max) || null);
  storeOrdersModel.update(draft.id, {
    delivery_type: input.deliveryType,
    recipient_name: clean(input.recipientName, 80),
    phone: clean(input.phone, 30),
    address: clean(input.address, 200),
    address_reference: clean(input.addressReference, 200),
    notes: clean(input.notes, 400),
  });
  refreshDraft(store, storeOrdersModel.get(store.id, draft.id)!);
}

export function setPaymentMethod(store: Store, customer: StoreCustomer, method: PaymentMethod): void {
  if (method === 'transfer' && !store.accepts_transfer) throw new StoreError('Este negocio no recibe transferencias.');
  if (method === 'cash' && !store.accepts_cash) throw new StoreError('Este negocio no recibe efectivo contra entrega, solo transferencia.');
  const draft = draftFor(store, customer);
  storeOrdersModel.update(draft.id, { payment_method: method });
}

// ------------------------------------------------------------------ texts

export function itemsText(items: StoreOrderItem[]): string {
  return items
    .map((i) => `• ${i.quantity} × ${i.name} — ${money(i.unit_price * i.quantity)}${i.notes ? `\n   _${i.notes}_` : ''}`)
    .join('\n');
}

function paymentText(order: OrderView): string {
  if (order.payment_method === 'cash') return 'Efectivo contra entrega';
  if (order.payment_method !== 'transfer') return 'Sin definir';
  const proof = order.proof;
  const read = proof?.amount ? ` (${money(proof.amount)}${proof.amountMatches ? ' ✓' : ' ≠ total'})` : '';
  const state = { pending: 'comprobante pendiente', proof_received: `comprobante recibido${read}`, verified: 'pago verificado', rejected: 'comprobante rechazado', on_delivery: '' }[order.payment_status];
  return `Transferencia · ${state}`;
}

function deliveryText(store: Store, order: StoreOrder): string {
  if (order.delivery_type === 'pickup') return `🛍️ Recoge en el local${store.address ? ` (${store.address})` : ''}`;
  return `🛵 Domicilio: ${order.address ?? 'sin dirección'}${order.address_reference ? ` (${order.address_reference})` : ''}`;
}

/** The order as the customer and the business read it. */
export function orderSummaryText(store: Store, order: OrderView): string {
  const lines = [itemsText(order.items), ''];
  if (order.delivery_fee > 0) lines.push(`Subtotal: ${money(order.subtotal)}`, `Domicilio: ${money(order.delivery_fee)}`);
  else if (order.delivery_type === 'delivery') lines.push('Domicilio: gratis');
  lines.push(`*Total: ${money(order.total)}*`, '', deliveryText(store, order));
  if (order.recipient_name) lines.push(`👤 ${order.recipient_name}${order.phone ? ` · ${order.phone}` : ''}`);
  lines.push(`💳 ${paymentText(order)}`);
  if (order.notes) lines.push(`📝 ${order.notes}`);
  return lines.join('\n');
}

function adminOrderNotice(store: Store, order: OrderView, customer: StoreCustomer, heading: string, footer: string): string {
  const who = `${order.recipient_name ?? customer.name ?? 'Cliente'}${customer.phone ? ` · +${customer.phone}` : ''}`;
  return `${heading} · ${store.name}\n👤 ${who}\n\n${orderSummaryText(store, order)}${footer ? `\n\n${footer}` : ''}`;
}

const REACT_CONFIRM = '_Reacciona a este mensaje:_ 👍 confirmar · 👎 rechazar';
const REACT_SHIP = '_Reacciona 👍 a este mensaje cuando el pedido salga._';

// ------------------------------------------------------------------ customer actions

/** The customer confirms the cart: it becomes an order waiting for the business. */
export async function placeOrder(store: Store, customer: StoreCustomer): Promise<OrderView> {
  const cart = cartOf(store, customer);
  if (!cart) throw new StoreError('No hay un pedido en curso.');
  if (cart.dropped.length) throw new StoreError(`Ya no hay disponibilidad de: ${cart.dropped.join(', ')}. Se quitaron del pedido; revísalo con el cliente antes de confirmar.`);
  if (cart.missing.length) throw new StoreError(`Todavía falta: ${cart.missing.join('; ')}.`);

  const draft = cart.order;
  const now = nowLocal();
  db.transaction(() => {
    storeOrdersModel.update(draft.id, {
      number: storesModel.takeOrderNumber(store.id),
      status: 'pending',
      placed_at: now,
      payment_status: draft.payment_method === 'cash' ? 'on_delivery' : draft.proof_media ? 'proof_received' : 'pending',
    });
    storeOrdersModel.addEvent(draft.id, 'placed', 'El cliente confirmó el pedido con el asistente.');
    // Remembered for the next order: "¿a la misma dirección?"
    storeCustomersModel.update(customer.id, {
      name: draft.recipient_name ?? undefined,
      address: draft.delivery_type === 'delivery' ? (draft.address ?? undefined) : undefined,
      address_reference: draft.delivery_type === 'delivery' ? (draft.address_reference ?? undefined) : undefined,
    });
  })();

  const order = orderView(storeOrdersModel.get(store.id, draft.id)!);
  console.log('[STORE] Order %s placed in store #%d (%s).', orderLabel(order), store.id, money(order.total));
  await notifyMembers(store, adminOrderNotice(store, order, customer, `🛎️ *Nuevo pedido ${orderLabel(order)}*`, REACT_CONFIRM), { order_id: order.id, action: 'confirm' });
  return order;
}

/** The order a receipt belongs to: the one waiting for payment, else the cart being built. */
export function orderAwaitingProof(store: Store, customer: StoreCustomer): StoreOrder | undefined {
  const placed = storeOrdersModel
    .recentOfCustomer(customer.id)
    .find((o) => (o.status === 'pending' || o.status === 'confirmed') && o.payment_method === 'transfer' && o.payment_status !== 'verified');
  if (placed) return placed;
  const cart = cartOf(store, customer);
  return cart && cart.order.items.length && cart.order.payment_method !== 'cash' ? cart.order : undefined;
}

export async function attachPaymentProof(store: Store, customer: StoreCustomer, order: StoreOrder, media: string, reading: PaymentProofReading): Promise<OrderView> {
  storeOrdersModel.update(order.id, {
    proof_media: media,
    proof_data: JSON.stringify(reading),
    payment_method: 'transfer',
    payment_status: order.status === 'draft' ? order.payment_status : 'proof_received',
  });
  storeOrdersModel.addEvent(order.id, 'proof_received', reading.amount ? `Comprobante por ${money(reading.amount)}${reading.bank ? ` (${reading.bank})` : ''}.` : 'Comprobante recibido.');
  const updated = orderView(storeOrdersModel.get(store.id, order.id)!);
  if (updated.status === 'pending') {
    await notifyMembers(store, adminOrderNotice(store, updated, customer, `💳 *Comprobante recibido · pedido ${orderLabel(updated)}*`, REACT_CONFIRM), { order_id: updated.id, action: 'confirm' });
  } else if (updated.status === 'confirmed') {
    await notifyMembers(store, `💳 *Comprobante recibido · pedido ${orderLabel(updated)}* · ${store.name}\n${paymentText(updated)}\nRevísalo en el portal.`);
  }
  return updated;
}

export async function cancelByCustomer(store: Store, customer: StoreCustomer, reason: string | null): Promise<StoreOrder> {
  const order = storeOrdersModel.recentOfCustomer(customer.id).find((o) => o.status === 'pending');
  if (!order) throw new StoreError('No hay un pedido pendiente que el cliente pueda cancelar (uno ya confirmado lo revisa una persona del negocio).');
  storeOrdersModel.update(order.id, { status: 'cancelled', status_reason: reason, closed_at: nowLocal() });
  storeOrdersModel.addEvent(order.id, 'cancelled', `Cancelado por el cliente${reason ? `: ${reason}` : ''}.`);
  await notifyMembers(store, `❌ *Pedido ${orderLabel(order)} cancelado por el cliente* · ${store.name}${reason ? `\nMotivo: ${reason}` : ''}`);
  return storeOrdersModel.get(store.id, order.id)!;
}

// ------------------------------------------------------------------ business actions

function requireOrder(storeId: number, orderId: number): { store: Store; order: StoreOrder; customer: StoreCustomer } {
  const store = storesModel.get(storeId);
  const order = store && storeOrdersModel.get(storeId, orderId);
  const customer = order && storeCustomersModel.get(storeId, order.customer_id);
  if (!store || !order || !customer || order.status === 'draft') throw new StoreError('Ese pedido no existe.');
  return { store, order, customer };
}

const STATUS_WORD: Record<string, string> = { pending: 'por confirmar', confirmed: 'confirmado', shipped: 'enviado', delivered: 'entregado', rejected: 'rechazado', cancelled: 'cancelado' };

export async function confirmOrder(storeId: number, orderId: number, actorId: number | null): Promise<OrderListRow> {
  const { order, customer } = requireOrder(storeId, orderId);
  if (order.status !== 'pending') throw new StoreError(`El pedido ${orderLabel(order)} ya está ${STATUS_WORD[order.status]}.`);
  // Confirming with the receipt in front is the business accepting that payment.
  const paymentStatus = order.payment_status === 'proof_received' ? 'verified' : order.payment_status;
  storeOrdersModel.update(order.id, { status: 'confirmed', confirmed_at: nowLocal(), payment_status: paymentStatus });
  storeOrdersModel.addEvent(order.id, 'confirmed', null, actorId);

  const next = order.delivery_type === 'pickup' ? 'Te avisamos apenas esté listo para que pases por él.' : 'Ya lo estamos preparando y te avisamos apenas salga para tu dirección.';
  const pay = order.payment_method === 'transfer' && paymentStatus === 'pending' ? '\n\nPara despacharlo necesitamos el comprobante de la transferencia: envíanos la foto por aquí. 🙏' : '';
  await sendToCustomer(customer, { role: 'system', text: `✅ *¡Tu pedido ${orderLabel(order)} ha sido confirmado!*\n${next}${pay}` });
  return storeOrdersModel.getRow(storeId, orderId)!;
}

export async function rejectOrder(storeId: number, orderId: number, actorId: number | null, reason: string | null): Promise<OrderListRow> {
  const { order, customer } = requireOrder(storeId, orderId);
  if (order.status !== 'pending') throw new StoreError(`El pedido ${orderLabel(order)} ya está ${STATUS_WORD[order.status]}.`);
  storeOrdersModel.update(order.id, { status: 'rejected', status_reason: reason, closed_at: nowLocal() });
  storeOrdersModel.addEvent(order.id, 'rejected', reason, actorId);
  await sendToCustomer(customer, {
    role: 'system',
    text: `😔 Lo sentimos, no pudimos tomar tu pedido ${orderLabel(order)}.${reason ? `\nMotivo: ${reason}` : ''}\n\nSi quieres, escríbenos y lo ajustamos.`,
  });
  return storeOrdersModel.getRow(storeId, orderId)!;
}

export async function shipOrder(storeId: number, orderId: number, actorId: number | null): Promise<OrderListRow> {
  const { store, order, customer } = requireOrder(storeId, orderId);
  if (order.status !== 'confirmed') throw new StoreError(order.status === 'pending' ? `Primero confirma el pedido ${orderLabel(order)}.` : `El pedido ${orderLabel(order)} ya está ${STATUS_WORD[order.status]}.`);
  storeOrdersModel.update(order.id, { status: 'shipped', shipped_at: nowLocal() });
  storeOrdersModel.addEvent(order.id, 'shipped', null, actorId);
  const cash = order.payment_method === 'cash' ? `\nPagas al recibir: *${money(order.total)}* en efectivo.` : '';
  const text =
    order.delivery_type === 'pickup'
      ? `🛍️ *¡Tu pedido ${orderLabel(order)} está listo para recoger!*${store.address ? `\nTe esperamos en ${store.address}.` : ''}${cash}`
      : `🛵 *¡Tu pedido ${orderLabel(order)} ha sido enviado!*\nVa en camino a ${order.address}.${cash}`;
  await sendToCustomer(customer, { role: 'system', text });
  return storeOrdersModel.getRow(storeId, orderId)!;
}

export async function deliverOrder(storeId: number, orderId: number, actorId: number | null): Promise<OrderListRow> {
  const { store, order, customer } = requireOrder(storeId, orderId);
  if (order.status !== 'shipped' && order.status !== 'confirmed') throw new StoreError(`El pedido ${orderLabel(order)} está ${STATUS_WORD[order.status]}: no se puede marcar como entregado.`);
  const now = nowLocal();
  storeOrdersModel.update(order.id, {
    status: 'delivered',
    delivered_at: now,
    closed_at: now,
    shipped_at: order.shipped_at ?? now,
    payment_status: order.payment_status === 'on_delivery' ? 'verified' : order.payment_status,
  });
  storeOrdersModel.addEvent(order.id, 'delivered', null, actorId);
  await sendToCustomer(customer, { role: 'system', text: `🎉 Pedido ${orderLabel(order)} entregado. ¡Gracias por comprar en ${store.name}!` });
  return storeOrdersModel.getRow(storeId, orderId)!;
}

export async function cancelOrder(storeId: number, orderId: number, actorId: number | null, reason: string | null): Promise<OrderListRow> {
  const { order, customer } = requireOrder(storeId, orderId);
  if (order.status !== 'confirmed' && order.status !== 'shipped' && order.status !== 'pending') throw new StoreError(`El pedido ${orderLabel(order)} ya está ${STATUS_WORD[order.status]}.`);
  storeOrdersModel.update(order.id, { status: 'cancelled', status_reason: reason, closed_at: nowLocal() });
  storeOrdersModel.addEvent(order.id, 'cancelled', reason, actorId);
  await sendToCustomer(customer, { role: 'system', text: `❌ Tu pedido ${orderLabel(order)} fue cancelado.${reason ? `\nMotivo: ${reason}` : ''}\n\nCualquier duda, escríbenos por aquí.` });
  return storeOrdersModel.getRow(storeId, orderId)!;
}

/** The business' verdict on a transfer receipt. Rejecting it asks the customer for a valid one. */
export async function reviewPayment(storeId: number, orderId: number, actorId: number | null, verdict: 'verified' | 'rejected', reason: string | null): Promise<OrderListRow> {
  const { order, customer } = requireOrder(storeId, orderId);
  if (order.payment_method !== 'transfer') throw new StoreError('Este pedido no se paga por transferencia.');
  storeOrdersModel.update(order.id, { payment_status: verdict });
  storeOrdersModel.addEvent(order.id, verdict === 'verified' ? 'payment_verified' : 'payment_rejected', reason, actorId);
  if (verdict === 'rejected') {
    await sendToCustomer(customer, {
      role: 'system',
      text: `⚠️ No pudimos validar el comprobante de tu pedido ${orderLabel(order)}.${reason ? `\n${reason}` : ''}\n\n¿Nos envías de nuevo la foto del comprobante de la transferencia?`,
    });
  } else {
    internalNote(customer, `Pago del pedido ${orderLabel(order)} verificado.`);
  }
  return storeOrdersModel.getRow(storeId, orderId)!;
}

// ------------------------------------------------------------------ reactions to the WhatsApp notices

/**
 * A member of the business reacted to one of the order notices: 👍 confirms (or marks shipped,
 * depending on the notice), 👎 rejects. Returns what to answer them, or null when the reaction
 * means nothing here. `followUp` is a notice to send and remember for the next step.
 */
export async function applyNoticeReaction(
  notice: { store_id: number; order_id: number; user_id: number; action: 'confirm' | 'ship' },
  positive: boolean,
): Promise<{ reply: string; followUp?: { order_id: number; action: 'ship' } } | null> {
  const order = storeOrdersModel.get(notice.store_id, notice.order_id);
  if (!order) return null;
  try {
    if (notice.action === 'confirm') {
      if (positive) {
        await confirmOrder(notice.store_id, order.id, notice.user_id);
        return { reply: `✅ Pedido ${orderLabel(order)} confirmado. Ya le avisé al cliente.\n\n${REACT_SHIP}`, followUp: { order_id: order.id, action: 'ship' } };
      }
      await rejectOrder(notice.store_id, order.id, notice.user_id, null);
      return { reply: `Pedido ${orderLabel(order)} rechazado. Ya le avisé al cliente.` };
    }
    if (!positive) return null;
    await shipOrder(notice.store_id, order.id, notice.user_id);
    return { reply: order.delivery_type === 'pickup' ? `🛍️ Pedido ${orderLabel(order)} listo para recoger. Ya le avisé al cliente.` : `🛵 Pedido ${orderLabel(order)} marcado como enviado. Ya le avisé al cliente.` };
  } catch (err) {
    if (err instanceof StoreError) return { reply: err.message };
    throw err;
  }
}
