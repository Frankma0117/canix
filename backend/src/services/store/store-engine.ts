import { jidNormalizedUser } from 'baileys';
import type { WaManager, IncomingHandler } from '../../channels/whatsapp/wa-manager.js';
import { storeCustomersModel, storeMessagesModel, storeNoticesModel, storesModel } from '../../models/store.model.js';
import { addMinutes, nowLocal } from '../../shared/utils/datetime.js';
import { readingPauseMs, sleep, typingDelayMs } from '../../shared/utils/human-delay.js';
import { jidToPhone } from '../../shared/utils/jid.js';
import { saveStoreImage, StoreMediaError } from './store-media.service.js';
import { readPaymentProof } from './payment-proof.service.js';
import { money } from './store-pricing.js';
import { internalNote, notifyMembers, sendToCustomer } from './store-outbox.js';
import { applyNoticeReaction, attachPaymentProof, orderAwaitingProof, orderLabel } from './store-orders.service.js';
import { cartPreview, runStoreAgent } from './store-agent.js';
import { appointmentOfNotice, cancelAppointmentByBusiness } from './store-booking.service.js';
import { setMainSession, setStoreSessionHandlers, storeSession } from './store-sessions.js';
import type { PaymentProofReading, Store, StoreCustomer } from '../../entities/index.js';

/**
 * The incoming side of the order-taking assistant: what happens when a customer writes to a
 * store's number (or to the portal's test chat).
 *
 *   message ─► saved to the conversation ─► [a person has the chat? stop]
 *           ─► photo? read it as a payment receipt and attach it to the order
 *           ─► assistant turn (store-agent.ts) ─► reply ─► [asked for a person? hand off + notify]
 *
 * One queue per customer: their messages are answered strictly in order, and a burst of short
 * messages ("hola" / "quiero pedir" / "2 hamburguesas") gets ONE answer that saw them all.
 */

/** A chat a person took over goes back to the assistant after this long without them writing. */
const HUMAN_MODE_TIMEOUT_MINUTES = 12 * 60;
/** How long to wait for the rest of a burst before answering (WhatsApp only). */
const BURST_WAIT_MS = 1_500;
const TURN_MAX_MS = 150_000;

const TECH_PROBLEM_REPLY = 'Dame un momento, por favor 🙏 Te paso con una persona del equipo para ayudarte mejor.';

const queues = new Map<number, Promise<void>>();
/** Turns queued or running per customer - the portal shows "escribiendo…" while there is one. */
const pendingTurns = new Map<number, number>();

export function isCustomerBusy(customerId: number): boolean {
  return (pendingTurns.get(customerId) ?? 0) > 0;
}
/** Id of the last customer message each chat's assistant turn has already seen. */
const answeredUpTo = new Map<number, number>();
/** Photos that arrived and still have to be looked at, per customer. */
const pendingImages = new Map<number, { media: string; buffer: Buffer }[]>();

function enqueue(customerId: number, task: () => Promise<void>): Promise<void> {
  pendingTurns.set(customerId, (pendingTurns.get(customerId) ?? 0) + 1);
  const settle = () => {
    const left = (pendingTurns.get(customerId) ?? 1) - 1;
    if (left > 0) pendingTurns.set(customerId, left);
    else pendingTurns.delete(customerId);
  };
  const run = async () => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      task().catch((err: unknown) => console.error('[STORE] Turn failed for customer #%d:', customerId, err)),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.error('[STORE] Turn of customer #%d exceeded %ds, releasing its queue.', customerId, TURN_MAX_MS / 1000);
          resolve();
        }, TURN_MAX_MS);
      }),
    ]).finally(() => {
      clearTimeout(timer);
      settle();
    });
  };
  const chain = (queues.get(customerId) ?? Promise.resolve()).then(run, run);
  queues.set(customerId, chain);
  void chain.finally(() => {
    if (queues.get(customerId) === chain) queues.delete(customerId);
  });
  return chain;
}

// ------------------------------------------------------------------ hand-off

export async function handoffToHuman(store: Store, customer: StoreCustomer, reason: string): Promise<void> {
  storeCustomersModel.setMode(customer.id, 'human', reason);
  internalNote(customer, `🙋 Conversación pasada a una persona. Motivo: ${reason}`);
  const last = storeMessagesModel
    .recent(customer.id, 12)
    .filter((m) => m.role === 'customer')
    .pop();
  const cart = cartPreview(store, customer);
  await notifyMembers(
    store,
    `🙋 *Un cliente necesita atención de una persona* · ${store.name}\n` +
      `👤 ${customer.name ?? 'Cliente'}${customer.phone ? ` · +${customer.phone}` : ''}\n` +
      `Motivo: ${reason}` +
      (last ? `\nÚltimo mensaje: "${last.body.slice(0, 200)}"` : '') +
      (cart ? `\n\nPedido en curso:\n${cart}` : '') +
      `\n\nRespóndele desde el portal (Conversaciones) o desde el WhatsApp del negocio. El asistente queda en pausa en ese chat hasta que lo devuelvas.`,
  );
}

export function returnToBot(customer: StoreCustomer, note = 'Conversación devuelta al asistente.'): void {
  storeCustomersModel.setMode(customer.id, 'bot');
  internalNote(customer, `🤖 ${note}`);
}

/** A person of the business writes to the customer from the portal: they take the chat over. */
export async function sendAgentMessage(customer: StoreCustomer, text: string): Promise<void> {
  if (customer.mode !== 'human') storeCustomersModel.setMode(customer.id, 'human', 'Una persona del negocio tomó la conversación.');
  await sendToCustomer(customer, { role: 'agent', text });
  storeCustomersModel.markRead(customer.id);
}

// ------------------------------------------------------------------ incoming

/**
 * The note left in the conversation after looking at a photo. Written for the business (they read
 * it in Conversaciones); the assistant reads it too, and its rules say what to do with each case.
 */
function proofNote(order: { number: number | null; id: number; status: string; total: number } | undefined, reading: PaymentProofReading | null): string {
  if (reading && !reading.isProof) return `📷 Imagen recibida, no es un comprobante de pago: ${reading.seen ?? 'no se pudo describir'}.`;
  const target = order ? (order.status === 'draft' ? 'el pedido en curso' : `el pedido ${orderLabel(order)}`) : null;
  if (!reading) {
    return target
      ? `📎 Imagen recibida y adjunta a ${target} como comprobante. No se pudo leer automáticamente: revísala.`
      : '📷 Imagen recibida. No se pudo leer y el cliente no tiene un pedido esperando pago.';
  }
  const fields = [
    reading.amount !== null ? money(reading.amount) : 'valor no legible',
    reading.bank ? `por ${reading.bank}` : '',
    reading.reference ? `ref. ${reading.reference}` : '',
    reading.date ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (!order) return `💳 Comprobante recibido (${fields}), pero el cliente no tiene ningún pedido esperando pago.`;
  const match =
    reading.amountMatches === true
      ? '✓ Coincide con el total.'
      : reading.amountMatches === false
        ? `⚠️ No coincide con el total (${money(order.total)}).`
        : `No se pudo comparar con el total (${money(order.total)}).`;
  return `💳 Comprobante adjunto a ${target}: ${fields}. ${match}`;
}

async function examineImages(store: Store, customer: StoreCustomer): Promise<void> {
  const images = pendingImages.get(customer.id) ?? [];
  pendingImages.delete(customer.id);
  for (const { media, buffer } of images) {
    const order = orderAwaitingProof(store, customer);
    const reading = await readPaymentProof(buffer, media, order?.total ?? null);
    if (order && (!reading || reading.isProof)) {
      const attached = reading ?? { isProof: true, amount: null, bank: null, reference: null, date: null, payer: null, recipient: null, seen: null, amountMatches: null };
      await attachPaymentProof(store, customer, order, media, attached);
    }
    internalNote(customer, proofNote(order, reading));
  }
}

/** Answers whatever the customer wrote since the assistant last looked, if it is the assistant's turn. */
async function respond(storeId: number, customerId: number, opts: { simulate: boolean }): Promise<void> {
  const store = storesModel.get(storeId);
  let customer = storeCustomersModel.get(storeId, customerId);
  if (!store || !customer) return;

  const latest = storeMessagesModel
    .recent(customerId, 30)
    .filter((m) => m.role === 'customer')
    .pop();
  if (!latest || latest.id <= (answeredUpTo.get(customerId) ?? 0)) return; // a previous turn already saw it
  answeredUpTo.set(customerId, latest.id);

  if (customer.mode === 'human') {
    const since = customer.handoff_at ?? customer.created_at;
    const lastPerson = storeMessagesModel
      .recent(customerId, 40)
      .filter((m) => m.role === 'agent')
      .pop();
    const idleSince = lastPerson && lastPerson.created_at > since ? lastPerson.created_at : since;
    if (addMinutes(idleSince, HUMAN_MODE_TIMEOUT_MINUTES) > nowLocal()) {
      pendingImages.delete(customerId); // the person sees the photo in the chat
      return;
    }
    returnToBot(customer, 'Pasaron más de 12 horas sin respuesta de una persona: el asistente retoma la conversación.');
    customer = storeCustomersModel.get(storeId, customerId)!;
  }
  if (!store.bot_enabled || !store.active) {
    pendingImages.delete(customerId);
    return;
  }

  await examineImages(store, customer);

  const wa = opts.simulate ? null : storeSession(store.id);
  if (wa) {
    await sleep(readingPauseMs());
    await wa.sendTyping(customer.jid);
  }
  const result = await runStoreAgent(store, customer);
  customer = storeCustomersModel.get(storeId, customerId) ?? customer;

  if (!result.ok) {
    await sendToCustomer(customer, { role: 'bot', text: TECH_PROBLEM_REPLY });
    await handoffToHuman(store, customer, 'El asistente tuvo un problema técnico y no pudo responder.');
    return;
  }
  if (result.reply) {
    if (wa) {
      await wa.sendTyping(customer.jid);
      await sleep(Math.min(typingDelayMs(result.reply), 3_500));
    }
    await sendToCustomer(customer, { role: 'bot', text: result.reply });
  }
  if (result.handoff) await handoffToHuman(store, customer, result.handoff);
}

export interface IncomingCustomerMessage {
  text: string;
  image?: Buffer;
}

/**
 * Entry point shared by WhatsApp and the portal's test chat. Resolves when the assistant has
 * finished answering (the test chat waits for it; WhatsApp doesn't need to).
 */
export async function receiveCustomerMessage(store: Store, customer: StoreCustomer, incoming: IncomingCustomerMessage): Promise<void> {
  if (incoming.image) {
    let media: string;
    try {
      media = await saveStoreImage(store.id, incoming.image, 'private');
    } catch (err) {
      if (!(err instanceof StoreMediaError)) throw err;
      storeMessagesModel.add(customer, { role: 'customer', body: incoming.text || '[Envió un archivo que no es una imagen]' });
      internalNote(customer, `El cliente envió un archivo que no se pudo recibir (${err.message}). Pídele que lo envíe como foto.`);
      return enqueue(customer.id, () => respond(store.id, customer.id, { simulate: !!customer.is_simulator }));
    }
    storeMessagesModel.add(customer, { role: 'customer', kind: 'image', body: incoming.text, media });
    pendingImages.set(customer.id, [...(pendingImages.get(customer.id) ?? []), { media, buffer: incoming.image }]);
  } else {
    storeMessagesModel.add(customer, { role: 'customer', body: incoming.text });
  }
  const simulate = !!customer.is_simulator;
  return enqueue(customer.id, async () => {
    if (!simulate) await sleep(BURST_WAIT_MS);
    await respond(store.id, customer.id, { simulate });
  });
}

// ------------------------------------------------------------------ WhatsApp wiring

/** The customer behind a chat of this store's number, created on their first message. */
async function customerOfChat(storeId: number, wa: WaManager, jid: string, altJid: string | undefined, name?: string): Promise<StoreCustomer> {
  let phoneJid: string | null = null;
  if (jid.endsWith('@s.whatsapp.net')) phoneJid = jidNormalizedUser(jid);
  else if (altJid?.endsWith('@s.whatsapp.net')) phoneJid = jidNormalizedUser(altJid);
  else if (jid.endsWith('@lid')) {
    const resolved = await wa.resolveLidToPhoneJid(jid);
    if (resolved?.endsWith('@s.whatsapp.net')) phoneJid = jidNormalizedUser(resolved);
  }
  const phone = phoneJid ? jidToPhone(phoneJid) : null;
  // Someone first seen under their @lid keeps that chat; their number is filled in once known.
  const existing = storeCustomersModel.byJid(storeId, jid) ?? (phoneJid ? storeCustomersModel.byJid(storeId, phoneJid) : undefined);
  if (existing) {
    if (phone && !existing.phone) storeCustomersModel.update(existing.id, { phone });
    if (name && !existing.name) storeCustomersModel.update(existing.id, { name });
    return storeCustomersModel.get(storeId, existing.id)!;
  }
  return storeCustomersModel.upsert(storeId, { jid: phoneJid ?? jid, phone, name: name ?? null });
}

async function onWhatsAppMessage(storeId: number, msg: Parameters<IncomingHandler>[0]): Promise<void> {
  const store = storesModel.get(storeId);
  if (!store || !store.active) return;
  const wa = storeSession(storeId);
  const customer = await customerOfChat(storeId, wa, msg.jid, msg.altJid, msg.name);

  let image: Buffer | undefined;
  if (msg.imageMessage) {
    try {
      image = await wa.downloadMedia(msg.imageMessage);
    } catch (err) {
      console.error('[STORE] Could not download an image in store #%d:', storeId, (err as Error).message);
    }
  }
  let text = msg.text;
  if (!text && !image) {
    if (msg.imageMessage) text = '[Envió una imagen que no se pudo descargar]';
    else if (msg.documentMessage) text = '[Envió un documento]';
    else if (msg.stickerMessage) text = '[Envió un sticker]';
    else if (msg.contactMessage) text = '[Compartió un contacto]';
    else return;
  }
  if (msg.fromAudio) text = `🎤 ${text}`;
  console.log('[STORE] #%d message from customer #%d%s', storeId, customer.id, image ? ' (image)' : '');
  // Not awaited: Baileys must not wait on a whole AI turn to hand over the next message.
  void receiveCustomerMessage(store, customer, { text, image });
}

/** A person answered from the business' phone itself: the assistant steps aside in that chat. */
async function onOwnMessage(storeId: number, msg: { jid: string; altJid?: string; text: string }): Promise<void> {
  const store = storesModel.get(storeId);
  if (!store) return;
  const customer = await customerOfChat(storeId, storeSession(storeId), msg.jid, msg.altJid);
  storeMessagesModel.add(customer, { role: 'agent', body: msg.text });
  if (customer.mode !== 'human') {
    storeCustomersModel.setMode(customer.id, 'human', 'Una persona respondió desde el teléfono del negocio.');
    internalNote(customer, '🙋 Una persona respondió desde el teléfono del negocio: el asistente queda en pausa en este chat hasta que lo devuelvas.');
  } else {
    // keeps the 12-hour idle clock running from the person's last message
    storeCustomersModel.setMode(customer.id, 'human', customer.handoff_reason);
  }
}

const POSITIVE = ['👍', '✅', '👌', '❤', '🙌'];
const NEGATIVE = ['👎', '❌', '🚫'];

/**
 * A 👍 / 👎 on one of the order notices sent to the business' people. `wa` is the session the
 * notice went out from (the store's, or Canix's as a fallback). True when it was one of ours.
 */
export async function handleStoreNoticeReaction(wa: WaManager, jid: string, targetId: string, emoji: string): Promise<boolean> {
  const notice = storeNoticesModel.byMessageId(targetId);
  if (!notice) {
    const appt = appointmentOfNotice(targetId);
    if (!appt) return false;
    if (NEGATIVE.some((e) => emoji.startsWith(e))) {
      const cancelled = await cancelAppointmentByBusiness(appt.store_id, appt.appointment_id);
      await wa.sendText(jid, cancelled ? '❌ Cita cancelada. Ya le avisé al cliente.' : 'Esa cita ya no estaba activa.').catch(() => undefined);
    }
    return true;
  }
  const positive = POSITIVE.some((e) => emoji.startsWith(e));
  if (!positive && !NEGATIVE.some((e) => emoji.startsWith(e))) return true;
  const result = await applyNoticeReaction(notice, positive);
  if (!result) return true;
  const id = await wa.sendTextWithId(jid, result.reply).catch(() => null);
  if (id && result.followUp) storeNoticesModel.add({ wa_message_id: id, store_id: notice.store_id, user_id: notice.user_id, ...result.followUp });
  return true;
}

/** Wires the stores' WhatsApp sessions to this engine. Called once at boot. */
export function initStoreEngine(mainSession: WaManager): void {
  setMainSession(mainSession);
  setStoreSessionHandlers({
    onMessage: onWhatsAppMessage,
    onOwnMessage,
    onReaction: async (storeId, { jid, targetId, emoji }) => {
      await handleStoreNoticeReaction(storeSession(storeId), jid, targetId, emoji);
    },
  });
}
