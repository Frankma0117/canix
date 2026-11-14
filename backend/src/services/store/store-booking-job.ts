import { db } from '../../database/connection.js';
import { addMinutes, nowLocal } from '../../shared/utils/datetime.js';
import { formatWhen } from '../scheduling/slots.js';
import { sendToCustomer } from './store-outbox.js';
import type { Store, StoreCustomer } from '../../entities/index.js';

/** The customer is reminded this long before the appointment (once). */
const REMIND_BEFORE_MINUTES = 180;

interface DueReminder {
  id: number;
  start_at: string;
  service_name: string;
  staff_name: string;
  store_id: number;
  customer_id: number;
}

/** Confirmed appointments starting within the reminder window that have not been reminded yet. */
export function dueReminders(now: string = nowLocal()): DueReminder[] {
  return db
    .prepare(
      `SELECT a.id, a.start_at, a.store_id, a.customer_id, p.name AS service_name, s.name AS staff_name
       FROM store_appointments a
       JOIN store_products p ON p.id = a.product_id
       JOIN store_staff s ON s.id = a.staff_id
       WHERE a.status = 'confirmed' AND a.reminded = 0 AND a.start_at > ? AND a.start_at <= ?`,
    )
    .all(now, addMinutes(now, REMIND_BEFORE_MINUTES)) as DueReminder[];
}

async function remindCustomers(): Promise<void> {
  for (const r of dueReminders()) {
    // Mark first: a failed send must not repeat every minute.
    db.prepare('UPDATE store_appointments SET reminded = 1 WHERE id = ?').run(r.id);
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(r.store_id) as Store | undefined;
    const customer = db.prepare('SELECT * FROM store_customers WHERE id = ?').get(r.customer_id) as StoreCustomer | undefined;
    if (!store || !customer || !store.active || customer.is_simulator) continue;
    await sendToCustomer(customer, {
      role: 'bot',
      text: `⏰ Recordatorio de tu cita en *${store.name}*: ${r.service_name} con ${r.staff_name}, ${formatWhen(r.start_at)}. Si no puedes asistir, avísame por aquí y la movemos o la cancelamos.`,
    }).catch((err) => console.error('[STORE-BOOKING] Reminder failed:', (err as Error).message));
  }
}

/** Every minute. Started once from index.ts. */
export function startStoreBookingJob(): void {
  const tick = () => void remindCustomers().catch((err) => console.error('[STORE-BOOKING] Job error:', (err as Error).message));
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 60_000).unref();
}
