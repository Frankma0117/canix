import { type Express, type Request } from 'express';
import { h, int, intArr, str } from '../http-helpers.js';
import { storesModel } from '../../models/store.model.js';
import { addDays, todayLocal } from '../../shared/utils/datetime.js';
import { canManageStore } from '../../services/store/store-access.service.js';
import { StoreError } from '../../services/store/store-orders.service.js';
import {
  knowledgeRepo,
  listServices,
  setAppointmentStatus,
  setServiceDuration,
  staffRepo,
  storeAppointments,
} from '../../services/store/store-booking.service.js';
import type { Store } from '../../entities/index.js';

/**
 * Appointments of a store (service businesses): services (products with a duration), staff and their
 * weekly hours, the business' knowledge base and the agenda. Same access rules as the rest of
 * /api/stores/:storeId (permission store.manage is applied in store.routes.ts).
 */

function storeOf(req: Request): Store {
  const store = storesModel.get(Number(req.params.storeId));
  if (!store || !canManageStore(req.panelUser!, store.id)) throw new StoreError('Ese negocio no existe.');
  return store;
}

const TIME = /^[0-2]\d:[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function registerStoreBookingRoutes(app: Express): void {
  // Services = products with a duration. Send duration_min null to stop offering it for booking.
  app.get(
    '/api/stores/:storeId/booking/services',
    h((req, res) => {
      res.json({ services: listServices(storeOf(req).id) });
    }),
  );

  app.put(
    '/api/stores/:storeId/booking/services/:productId',
    h((req, res) => {
      const store = storeOf(req);
      const raw = req.body?.duration_min;
      const duration = raw === null ? null : int(raw);
      if (duration !== null && (duration === undefined || duration < 5 || duration > 600)) throw new StoreError('La duración va de 5 a 600 minutos.');
      if (!setServiceDuration(store.id, Number(req.params.productId), duration)) throw new StoreError('Ese producto no existe.');
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- staff
  app.get(
    '/api/stores/:storeId/booking/staff',
    h((req, res) => {
      const store = storeOf(req);
      res.json({ staff: staffRepo.list(store.id).map((s) => ({ ...s, hours: staffRepo.hours(s.id) })) });
    }),
  );

  app.post(
    '/api/stores/:storeId/booking/staff',
    h((req, res) => {
      const store = storeOf(req);
      const name = str(req.body?.name, 80);
      if (!name) throw new StoreError('Ponle un nombre a la persona.');
      res.status(201).json({ staff: staffRepo.add(store.id, name, str(req.body?.specialty, 80) || null) });
    }),
  );

  app.patch(
    '/api/stores/:storeId/booking/staff/:id',
    h((req, res) => {
      const store = storeOf(req);
      const id = Number(req.params.id);
      const b = req.body ?? {};
      if (!staffRepo.update(store.id, id, { name: str(b.name, 80), specialty: b.specialty === undefined ? undefined : str(b.specialty, 80) || null, active: b.active === undefined ? undefined : !!b.active })) {
        throw new StoreError('Esa persona no existe.');
      }
      if (b.service_ids !== undefined) staffRepo.setServices(store.id, id, intArr(b.service_ids));
      if (Array.isArray(b.hours)) {
        const hours = (b.hours as Record<string, unknown>[]).map((x) => ({ weekday: Number(x.weekday), start_time: String(x.start_time), end_time: String(x.end_time) }));
        if (hours.some((x) => !(x.weekday >= 0 && x.weekday <= 6) || !TIME.test(x.start_time) || !TIME.test(x.end_time) || x.start_time >= x.end_time)) {
          throw new StoreError('Horario no válido: día 0-6 (0 = domingo), horas HH:mm y el inicio antes del fin.');
        }
        staffRepo.setHours(store.id, id, hours);
      }
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- agenda
  app.get(
    '/api/stores/:storeId/booking/appointments',
    h((req, res) => {
      const store = storeOf(req);
      const from = DATE.test(String(req.query.from)) ? String(req.query.from) : todayLocal();
      const to = DATE.test(String(req.query.to)) ? String(req.query.to) : addDays(from, 7).slice(0, 10);
      res.json({ appointments: storeAppointments(store.id, from, to) });
    }),
  );

  app.patch(
    '/api/stores/:storeId/booking/appointments/:id',
    h((req, res) => {
      const store = storeOf(req);
      const status = String(req.body?.status);
      if (!['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) throw new StoreError('Estado no válido.');
      if (!setAppointmentStatus(store.id, Number(req.params.id), status as 'confirmed' | 'cancelled' | 'completed' | 'no_show')) throw new StoreError('Esa cita no existe.');
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- knowledge
  app.get(
    '/api/stores/:storeId/booking/knowledge',
    h((req, res) => {
      res.json({ entries: knowledgeRepo.list(storeOf(req).id) });
    }),
  );

  app.post(
    '/api/stores/:storeId/booking/knowledge',
    h((req, res) => {
      const store = storeOf(req);
      const title = str(req.body?.title, 120);
      const content = str(req.body?.content, 2000);
      if (!title || !content) throw new StoreError('Escribe el título y el contenido.');
      res.status(201).json({ entry: knowledgeRepo.add(store.id, title, content) });
    }),
  );

  app.delete(
    '/api/stores/:storeId/booking/knowledge/:id',
    h((req, res) => {
      if (!knowledgeRepo.remove(storeOf(req).id, Number(req.params.id))) throw new StoreError('Esa entrada no existe.');
      res.json({ ok: true });
    }),
  );
}
