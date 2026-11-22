import { db } from '../../database/connection.js';
import { nowLocal } from '../../shared/utils/datetime.js';
import { storeMessagesModel, storeNoticesModel, storesModel, type AdminNotice } from '../../models/store.model.js';
import { usersModel } from '../../models/users.model.js';
import { getMainSession, storeSession } from './store-sessions.js';
import { readStoreImage } from './store-media.service.js';
import { toWhatsApp } from '../../shared/utils/wa-format.js';
import type { Store, StoreCustomer, StoreMessage, StoreMessageRole } from '../../entities/index.js';

/**
 * Everything the business says to a customer goes through here: it is written to the conversation
 * (so the portal shows the whole chat, whoever spoke) and sent over the store's WhatsApp number.
 * The portal's test chat ("Probar el bot") is a customer flagged `is_simulator`: same pipeline,
 * nothing sent to WhatsApp.
 */
export interface OutgoingMessage {
  role: Exclude<StoreMessageRole, 'customer'>;
  text: string;
  /** A stored image (product photo) sent with `text` as its caption. */
  image?: string | null;
}

export async function sendToCustomer(customer: StoreCustomer, out: OutgoingMessage): Promise<StoreMessage> {
  const text = out.role === 'bot' ? toWhatsApp(out.text) : out.text;
  const message = storeMessagesModel.add(customer, { role: out.role, body: text, kind: out.image ? 'image' : 'text', media: out.image ?? null });
  if (customer.is_simulator) return message;

  const wa = storeSession(customer.store_id);
  try {
    const image = out.image ? await readStoreImage(customer.store_id, out.image) : null;
    if (image) await wa.sendImageBuffer(customer.jid, image, text || undefined);
    else if (text) await wa.sendText(customer.jid, text);
  } catch (err) {
    // Kept in the conversation with a note, so the business sees it did not go out.
    console.error('[STORE] Could not send to customer #%d of store #%d:', customer.id, customer.store_id, (err as Error).message);
    storeMessagesModel.add(customer, { role: 'system', body: `⚠️ No se pudo entregar el mensaje anterior por WhatsApp (${(err as Error).message}).`, internal: true });
  }
  return message;
}

/** A note in the conversation that only the business sees (never sent to the customer). */
export function internalNote(customer: StoreCustomer, text: string): void {
  storeMessagesModel.add(customer, { role: 'system', body: text, internal: true });
}

/**
 * WhatsApp notice to the people who manage the store (new order, receipt received, a customer
 * asking for a person). Sent from the store's own number, or from Canix's when that one is not
 * connected. With `notice`, the sent message is remembered so a 👍 / 👎 on it acts on the order.
 */
export async function notifyMembers(
  store: Store,
  text: string,
  notice?: Pick<AdminNotice, 'order_id' | 'action'>,
  appointmentId?: number,
): Promise<void> {
  const members = storesModel.members(store.id).filter((m) => m.notify);
  for (const member of members) {
    const user = usersModel.getById(member.id);
    if (!user || user.jid.endsWith('@simulator')) continue;
    const own = storeSession(store.id);
    const main = getMainSession();
    // A store's number can't write to itself: that member is reached from Canix's number.
    const ownIsMember = own.ownPhone() !== null && user.jid.startsWith(`${own.ownPhone()}@`);
    const wa = own.isConnected() && !ownIsMember ? own : main?.isConnected() ? main : undefined;
    if (!wa) continue;
    try {
      const id = await wa.sendTextWithId(user.jid, text);
      if (id && notice) storeNoticesModel.add({ wa_message_id: id, store_id: store.id, user_id: user.id, ...notice });
      if (id && appointmentId) {
        db.prepare('INSERT OR REPLACE INTO store_appointment_notices (wa_message_id, store_id, appointment_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
          id,
          store.id,
          appointmentId,
          user.id,
          nowLocal(),
        );
      }
    } catch (err) {
      console.error('[STORE] Could not notify member #%d of store #%d:', user.id, store.id, (err as Error).message);
    }
  }
}
