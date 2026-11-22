// Run: DB_PATH=data/test-booking.db npx tsx scripts/booking-cancel-test.ts  (temporary DB, never data/app.db)
import assert from 'node:assert/strict';
import { db } from '../src/database/connection.js';
import { initSchema } from '../src/database/migrate.js';
import { appointmentOfNotice, cancelAppointmentByBusiness } from '../src/services/store/store-booking.service.js';

if (!String(process.env.DB_PATH).includes('test')) throw new Error('Use a temporary DB_PATH (contains "test")');
initSchema();

const now = '2030-01-01 10:00:00';
const store = Number(db.prepare("INSERT INTO stores (name, kind, created_at, updated_at) VALUES ('T', 'services', ?, ?)").run(now, now).lastInsertRowid);
const customer = Number(db.prepare("INSERT INTO store_customers (store_id, jid, name, created_at, is_simulator) VALUES (?, 'x@s.whatsapp.net', 'C', ?, 1)").run(store, now).lastInsertRowid);
const product = Number(db.prepare("INSERT INTO store_products (store_id, name, price, duration_min, created_at, updated_at) VALUES (?, 'Corte', 10, 30, ?, ?)").run(store, now, now).lastInsertRowid);
const staff = Number(db.prepare("INSERT INTO store_staff (store_id, name, created_at) VALUES (?, 'Ana', ?)").run(store, now).lastInsertRowid);
const appt = Number(
  db.prepare("INSERT INTO store_appointments (store_id, customer_id, staff_id, product_id, start_at, end_at, created_at, updated_at) VALUES (?, ?, ?, ?, '2030-01-02 09:00:00', '2030-01-02 09:30:00', ?, ?)").run(store, customer, staff, product, now, now).lastInsertRowid,
);
db.prepare("INSERT INTO store_appointment_notices (wa_message_id, store_id, appointment_id, user_id, created_at) VALUES ('m1', ?, ?, 1, ?)").run(store, appt, now);

assert.deepEqual(appointmentOfNotice('m1'), { store_id: store, appointment_id: appt });
assert.equal(appointmentOfNotice('nope'), undefined);
const first = await cancelAppointmentByBusiness(store, appt);
assert.equal(first?.status, 'cancelled');
assert.equal((db.prepare('SELECT cancel_reason r FROM store_appointments WHERE id = ?').get(appt) as { r: string }).r, 'Cancelada por el negocio');
assert.equal(await cancelAppointmentByBusiness(store, appt), null, 'second 👎 does nothing');
assert.equal(await cancelAppointmentByBusiness(store + 1, appt), null, 'other store cannot cancel');
console.log('OK: 5 checks');
