import { db } from '../../database/connection.js';
import { addDays, addMinutes, nowLocal, parseWall, todayLocal } from '../../shared/utils/datetime.js';
import { formatWhen } from '../scheduling/slots.js';
import { notifyMembers } from './store-outbox.js';
import type { Store, StoreCustomer } from '../../entities/index.js';

/**
 * Appointments for service businesses inside the order-taking assistant (what the standalone
 * "estylia" project used to do). A SERVICE is a store product with `duration_min`; staff have weekly
 * hours; the assistant books for the store's customers and the business' people get a notice.
 * Everything is scoped by `store_id`; routes and tools decide which store the caller may touch.
 */

const GRID_MINUTES = 30;
const MIN_NOTICE_MINUTES = 60;
const MAX_DAYS_AHEAD = 45;
const MAX_SLOTS_SHOWN = 12;

export interface BookableService {
  id: number;
  name: string;
  description: string | null;
  price: number;
  duration_min: number;
}
export interface Staff {
  id: number;
  store_id: number;
  name: string;
  specialty: string | null;
  active: number;
}
export interface StaffHour {
  id: number;
  staff_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
}
export interface FreeSlot {
  start_at: string;
  end_at: string;
  staff_id: number;
  staff_name: string;
}
export interface Appointment {
  id: number;
  store_id: number;
  customer_id: number;
  staff_id: number;
  product_id: number;
  start_at: string;
  end_at: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes: string | null;
  cancel_reason: string | null;
  service_name?: string;
  staff_name?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
}
export interface KnowledgeEntry {
  id: number;
  store_id: number;
  title: string;
  content: string;
}

const APPT_SELECT = `
  SELECT a.*, p.name AS service_name, s.name AS staff_name, c.name AS customer_name, c.phone AS customer_phone
  FROM store_appointments a
  JOIN store_products p ON p.id = a.product_id
  JOIN store_staff s ON s.id = a.staff_id
  JOIN store_customers c ON c.id = a.customer_id`;

// ------------------------------------------------------------------ services

export function listServices(storeId: number): BookableService[] {
  return db
    .prepare(
      `SELECT id, name, description, price, duration_min FROM store_products
       WHERE store_id = ? AND duration_min IS NOT NULL AND available = 1 ORDER BY position, name`,
    )
    .all(storeId) as BookableService[];
}

export function hasServices(storeId: number): boolean {
  return !!db.prepare('SELECT 1 FROM store_products WHERE store_id = ? AND duration_min IS NOT NULL LIMIT 1').get(storeId);
}

export function setServiceDuration(storeId: number, productId: number, durationMin: number | null): boolean {
  const r = db
    .prepare('UPDATE store_products SET duration_min = ?, updated_at = ? WHERE id = ? AND store_id = ?')
    .run(durationMin, nowLocal(), productId, storeId);
  return r.changes > 0;
}

// ------------------------------------------------------------------ staff

export const staffRepo = {
  list(storeId: number, onlyActive = false): Staff[] {
    return db
      .prepare(`SELECT * FROM store_staff WHERE store_id = ? ${onlyActive ? 'AND active = 1' : ''} ORDER BY name`)
      .all(storeId) as Staff[];
  },
  add(storeId: number, name: string, specialty?: string | null): Staff {
    const r = db
      .prepare('INSERT INTO store_staff (store_id, name, specialty, created_at) VALUES (?, ?, ?, ?)')
      .run(storeId, name.trim(), specialty ?? null, nowLocal());
    return db.prepare('SELECT * FROM store_staff WHERE id = ?').get(r.lastInsertRowid) as Staff;
  },
  update(storeId: number, id: number, patch: { name?: string; specialty?: string | null; active?: boolean }): boolean {
    const cur = db.prepare('SELECT * FROM store_staff WHERE id = ? AND store_id = ?').get(id, storeId) as Staff | undefined;
    if (!cur) return false;
    db.prepare('UPDATE store_staff SET name = ?, specialty = ?, active = ? WHERE id = ?').run(
      patch.name?.trim() || cur.name,
      patch.specialty === undefined ? cur.specialty : patch.specialty,
      patch.active === undefined ? cur.active : patch.active ? 1 : 0,
      id,
    );
    return true;
  },
  /** Replaces the services a person does (empty list = does every service). */
  setServices(storeId: number, id: number, productIds: number[]): boolean {
    if (!db.prepare('SELECT 1 FROM store_staff WHERE id = ? AND store_id = ?').get(id, storeId)) return false;
    db.transaction(() => {
      db.prepare('DELETE FROM store_staff_services WHERE staff_id = ?').run(id);
      const ins = db.prepare(
        'INSERT OR IGNORE INTO store_staff_services (staff_id, product_id) SELECT ?, id FROM store_products WHERE id = ? AND store_id = ?',
      );
      for (const pid of productIds) ins.run(id, pid, storeId);
    })();
    return true;
  },
  hours(staffId: number): StaffHour[] {
    return db.prepare('SELECT * FROM store_staff_hours WHERE staff_id = ? ORDER BY weekday, start_time').all(staffId) as StaffHour[];
  },
  /** Replaces the weekly hours: [{ weekday: 0-6 (0 = domingo), start_time: 'HH:mm', end_time: 'HH:mm' }]. */
  setHours(storeId: number, id: number, hours: { weekday: number; start_time: string; end_time: string }[]): boolean {
    if (!db.prepare('SELECT 1 FROM store_staff WHERE id = ? AND store_id = ?').get(id, storeId)) return false;
    db.transaction(() => {
      db.prepare('DELETE FROM store_staff_hours WHERE staff_id = ?').run(id);
      const ins = db.prepare('INSERT INTO store_staff_hours (staff_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
      for (const h of hours) ins.run(id, h.weekday, h.start_time, h.end_time);
    })();
    return true;
  },
};

/** Active staff who can do the service (people with no explicit services do all of them). */
function staffForService(storeId: number, productId: number, onlyStaffId?: number): Staff[] {
  return db
    .prepare(
      `SELECT s.* FROM store_staff s
       WHERE s.store_id = ? AND s.active = 1 ${onlyStaffId ? 'AND s.id = ?' : ''}
         AND (NOT EXISTS (SELECT 1 FROM store_staff_services x WHERE x.staff_id = s.id)
              OR EXISTS (SELECT 1 FROM store_staff_services x WHERE x.staff_id = s.id AND x.product_id = ?))
       ORDER BY s.name`,
    )
    .all(...(onlyStaffId ? [storeId, onlyStaffId, productId] : [storeId, productId])) as Staff[];
}

// ------------------------------------------------------------------ availability

/** Free start times for a service between two dates ('YYYY-MM-DD', inclusive), one entry per start time. */
export function freeSlots(storeId: number, productId: number, fromDate: string, toDate: string, staffId?: number): FreeSlot[] {
  const service = listServices(storeId).find((s) => s.id === productId);
  if (!service) return [];
  const today = todayLocal();
  const lastAllowed = addDays(today, MAX_DAYS_AHEAD).slice(0, 10);
  const from = fromDate < today ? today : fromDate;
  const to = toDate > lastAllowed ? lastAllowed : toDate;
  if (from > to) return [];
  const earliest = addMinutes(nowLocal(), MIN_NOTICE_MINUTES);
  const rangeStart = `${from} 00:00:00`;
  const rangeEnd = `${addDays(to, 1).slice(0, 10)} 00:00:00`;

  const byStart = new Map<string, FreeSlot>();
  for (const staff of staffForService(storeId, productId, staffId)) {
    const hours = staffRepo.hours(staff.id);
    if (!hours.length) continue;
    const busy = db
      .prepare("SELECT start_at, end_at FROM store_appointments WHERE staff_id = ? AND status = 'confirmed' AND start_at < ? AND end_at > ?")
      .all(staff.id, rangeEnd, rangeStart) as { start_at: string; end_at: string }[];
    for (let day = from; day <= to; day = addDays(day, 1).slice(0, 10)) {
      const weekday = parseWall(day).getUTCDay();
      for (const h of hours.filter((x) => x.weekday === weekday)) {
        const windowEnd = `${day} ${h.end_time}:00`;
        for (let start = `${day} ${h.start_time}:00`; addMinutes(start, service.duration_min) <= windowEnd; start = addMinutes(start, GRID_MINUTES)) {
          const end = addMinutes(start, service.duration_min);
          if (start < earliest || byStart.has(start)) continue;
          if (busy.some((b) => b.start_at < end && b.end_at > start)) continue;
          byStart.set(start, { start_at: start, end_at: end, staff_id: staff.id, staff_name: staff.name });
        }
      }
    }
  }
  return [...byStart.values()].sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
}

export function shownSlots(slots: FreeSlot[]): FreeSlot[] {
  // Spread the offer over the days instead of listing only the first morning.
  const perDay = new Map<string, FreeSlot[]>();
  for (const s of slots) {
    const d = s.start_at.slice(0, 10);
    (perDay.get(d) ?? perDay.set(d, []).get(d)!).push(s);
  }
  const out: FreeSlot[] = [];
  for (let i = 0; out.length < MAX_SLOTS_SHOWN; i++) {
    let added = false;
    for (const list of perDay.values()) {
      if (list[i] && out.length < MAX_SLOTS_SHOWN) {
        out.push(list[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
}

// ------------------------------------------------------------------ appointments

export type BookResult = { ok: true; appointment: Appointment } | { ok: false; error: string };

export async function bookAppointment(
  store: Store,
  customer: StoreCustomer,
  input: { productId: number; startAt: string; staffId?: number; notes?: string },
): Promise<BookResult> {
  const service = listServices(store.id).find((s) => s.id === input.productId);
  if (!service) return { ok: false, error: 'Ese servicio no existe o no se puede agendar.' };
  const day = input.startAt.slice(0, 10);
  const slot = freeSlots(store.id, service.id, day, day, input.staffId).find((s) => s.start_at === input.startAt);
  if (!slot) return { ok: false, error: 'Ese horario ya no está disponible. Ofrece otros con check_availability.' };

  let id: number;
  try {
    id = Number(
      db
        .prepare(
          `INSERT INTO store_appointments (store_id, customer_id, staff_id, product_id, start_at, end_at, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(store.id, customer.id, slot.staff_id, service.id, slot.start_at, slot.end_at, input.notes ?? null, nowLocal(), nowLocal()).lastInsertRowid,
    );
  } catch {
    return { ok: false, error: 'Ese horario se acaba de ocupar. Ofrece otros con check_availability.' };
  }
  const appointment = db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id) as Appointment;
  await notifyMembers(
    store,
    `🗓️ *Nueva cita* · ${store.name}\n${appointment.service_name} con ${appointment.staff_name}\n${formatWhen(appointment.start_at)}\n` +
      `👤 ${customer.name ?? 'Cliente'}${customer.phone ? ` · +${customer.phone}` : ''}${input.notes ? `\nNota: ${input.notes}` : ''}`,
  );
  return { ok: true, appointment };
}

export function customerAppointments(customerId: number): Appointment[] {
  return db
    .prepare(`${APPT_SELECT} WHERE a.customer_id = ? AND a.status = 'confirmed' AND a.end_at >= ? ORDER BY a.start_at`)
    .all(customerId, nowLocal()) as Appointment[];
}

export async function cancelAppointment(store: Store, customer: StoreCustomer, appointmentId: number, reason?: string): Promise<Appointment | null> {
  const appt = db
    .prepare(`${APPT_SELECT} WHERE a.id = ? AND a.store_id = ? AND a.customer_id = ? AND a.status = 'confirmed'`)
    .get(appointmentId, store.id, customer.id) as Appointment | undefined;
  if (!appt) return null;
  db.prepare("UPDATE store_appointments SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?").run(reason ?? null, nowLocal(), appt.id);
  await notifyMembers(
    store,
    `❌ *Cita cancelada* · ${store.name}\n${appt.service_name} con ${appt.staff_name}, ${formatWhen(appt.start_at)}\n👤 ${customer.name ?? 'Cliente'}${reason ? `\nMotivo: ${reason}` : ''}`,
  );
  return { ...appt, status: 'cancelled' };
}

export async function rescheduleAppointment(store: Store, customer: StoreCustomer, appointmentId: number, newStartAt: string): Promise<BookResult> {
  const old = db
    .prepare(`${APPT_SELECT} WHERE a.id = ? AND a.store_id = ? AND a.customer_id = ? AND a.status = 'confirmed'`)
    .get(appointmentId, store.id, customer.id) as Appointment | undefined;
  if (!old) return { ok: false, error: 'No encuentro esa cita activa del cliente.' };
  // Book first: if the new time is not free, the old appointment stays untouched.
  const booked = await bookAppointment(store, customer, { productId: old.product_id, startAt: newStartAt, staffId: old.staff_id, notes: old.notes ?? undefined });
  const result = booked.ok ? booked : await bookAppointment(store, customer, { productId: old.product_id, startAt: newStartAt, notes: old.notes ?? undefined });
  if (!result.ok) return result;
  db.prepare("UPDATE store_appointments SET status = 'cancelled', cancel_reason = 'Reprogramada', updated_at = ? WHERE id = ?").run(nowLocal(), old.id);
  return result;
}

/** Appointments of a store between two dates (for the business' own agenda). */
export function storeAppointments(storeId: number, fromDate: string, toDate: string): Appointment[] {
  return db
    .prepare(`${APPT_SELECT} WHERE a.store_id = ? AND a.start_at >= ? AND a.start_at < ? ORDER BY a.start_at`)
    .all(storeId, `${fromDate} 00:00:00`, `${addDays(toDate, 1).slice(0, 10)} 00:00:00`) as Appointment[];
}

export function setAppointmentStatus(storeId: number, id: number, status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'): boolean {
  return db.prepare('UPDATE store_appointments SET status = ?, updated_at = ? WHERE id = ? AND store_id = ?').run(status, nowLocal(), id, storeId).changes > 0;
}

// ------------------------------------------------------------------ knowledge

export const knowledgeRepo = {
  list(storeId: number): KnowledgeEntry[] {
    return db.prepare('SELECT * FROM store_knowledge WHERE store_id = ? ORDER BY title').all(storeId) as KnowledgeEntry[];
  },
  add(storeId: number, title: string, content: string): KnowledgeEntry {
    const r = db.prepare('INSERT INTO store_knowledge (store_id, title, content, created_at) VALUES (?, ?, ?, ?)').run(storeId, title.trim(), content.trim(), nowLocal());
    return db.prepare('SELECT * FROM store_knowledge WHERE id = ?').get(r.lastInsertRowid) as KnowledgeEntry;
  },
  remove(storeId: number, id: number): boolean {
    return db.prepare('DELETE FROM store_knowledge WHERE id = ? AND store_id = ?').run(id, storeId).changes > 0;
  },
  /** Entries whose title or content contain any word (3+ letters) of the query, best matches first. */
  search(storeId: number, query: string): KnowledgeEntry[] {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const words = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (!words.length) return [];
    return knowledgeRepo
      .list(storeId)
      .map((e) => ({ e, score: words.filter((w) => norm(`${e.title} ${e.content}`).includes(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.e);
  },
};
