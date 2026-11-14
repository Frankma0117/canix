import type Database from 'better-sqlite3';
import { ensureColumn } from '../schema-helpers.js';

/**
 * Appointments for service businesses (beauty salons, clinics...) inside the order-taking
 * assistant. Unifies what the old standalone "estylia" project did: a catalog of services (a store
 * product with `duration_min`), staff with their weekly hours, appointments booked by the store's
 * customers over WhatsApp, and a small knowledge base the assistant answers from.
 * Wall-clock 'YYYY-MM-DD HH:mm:ss' timestamps in env.timezone, like everywhere else.
 */
export function initStoreBookingSchema(db: Database.Database): void {
  // A product with a duration is a SERVICE that can be booked.
  ensureColumn(db, 'store_products', 'duration_min', 'duration_min INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 5 AND 600)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      specialty TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_staff_store ON store_staff(store_id, active);

    -- Services a person can do. A person with NO rows here does every service.
    CREATE TABLE IF NOT EXISTS store_staff_services (
      staff_id INTEGER NOT NULL REFERENCES store_staff(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
      PRIMARY KEY (staff_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS store_staff_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES store_staff(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
      end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
      CHECK (start_time < end_time)
    );
    CREATE INDEX IF NOT EXISTS idx_store_staff_hours ON store_staff_hours(staff_id, weekday);

    CREATE TABLE IF NOT EXISTS store_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
      staff_id INTEGER NOT NULL REFERENCES store_staff(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
      notes TEXT,
      cancel_reason TEXT,
      reminded INTEGER NOT NULL DEFAULT 0 CHECK (reminded IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (start_at < end_at)
    );
    -- One person cannot have two active appointments starting at the same time.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_store_appt_active_start
      ON store_appointments(staff_id, start_at) WHERE status = 'confirmed';
    CREATE INDEX IF NOT EXISTS idx_store_appt_store ON store_appointments(store_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_store_appt_customer ON store_appointments(customer_id, start_at);

    -- Answers the assistant may use (policies, prices of extras, aftercare...). Searched by words.
    CREATE TABLE IF NOT EXISTS store_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_knowledge_store ON store_knowledge(store_id);
  `);
}
