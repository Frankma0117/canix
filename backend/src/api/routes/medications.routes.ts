import type { Express, Request } from 'express';
import { medicationsModel, type MedicationFields } from '../../models/medications.model.js';
import { MEDICATION_KINDS, adherence, dayProgress, createMedication, isMedicationKind, logMedicationAnswer, timesOf, updateMedication } from '../../services/medications/medications.service.js';
import { normalizeTimes } from '../../shared/utils/clock-times.js';
import { todayLocal } from '../../shared/utils/datetime.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, userId, str } from '../http-helpers.js';
import type { Medication } from '../../entities/index.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Optional text: undefined = not sent, null = cleared. */
function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  return str(value, max) || null;
}

/** Optional date: undefined = not sent, null = cleared, invalid = undefined. */
function date(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return DATE_RE.test(String(value)) ? String(value) : undefined;
}

/** [1,3,5] -> weekdays; empty / all seven = every day. */
function weekdays(value: unknown): number[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return days.length && days.length < 7 ? days : null;
}

/** The editable fields of a request body (only those sent). */
function fieldsFrom(req: Request): MedicationFields {
  const b = req.body ?? {};
  return {
    name: str(b.name, 120) || undefined,
    kind: isMedicationKind(b.kind) ? b.kind : undefined,
    dose: text(b.dose, 120),
    instructions: text(b.instructions, 300),
    times: b.times === undefined ? undefined : normalizeTimes(b.times),
    weekdays: weekdays(b.weekdays),
    startDate: date(b.start_date),
    endDate: date(b.end_date),
    notes: text(b.notes, 1000),
    active: typeof b.active === 'boolean' ? b.active : undefined,
  };
}

/** A medication as the portal shows it: parsed times, the last week of doses and today's count (glasses for water). */
function view(med: Medication) {
  return { ...med, times: timesOf(med), weekdays: med.weekdays ? med.weekdays.split(',').map(Number) : null, active: med.active === 1, week: adherence(med, 7), today: dayProgress(med) };
}

/** Medicamentos y belleza (see services/medications/). */
export function registerMedicationRoutes(app: Express): void {
  app.use('/api/medications', requirePermission('medications.manage'));

  app.get(
    '/api/medications',
    h((req, res) => {
      res.json({ kinds: MEDICATION_KINDS, items: medicationsModel.list(userId(req), { includeInactive: true }).map(view) });
    }),
  );

  app.post(
    '/api/medications',
    h((req, res) => {
      const fields = fieldsFrom(req);
      if (!fields.name) return void res.status(400).json({ error: 'Falta el nombre.' });
      if (!fields.times?.length) return void res.status(400).json({ error: 'Necesito al menos una hora (HH:mm).' });
      const med = createMedication(userId(req), { ...fields, name: fields.name, times: fields.times, startDate: fields.startDate ?? todayLocal() });
      res.status(201).json(view(med));
    }),
  );

  app.patch(
    '/api/medications/:id',
    h((req, res) => {
      const fields = fieldsFrom(req);
      if (fields.times && fields.times.length === 0) return void res.status(400).json({ error: 'Necesito al menos una hora (HH:mm).' });
      const med = updateMedication(userId(req), Number(req.params.id), fields);
      if (!med) return void res.status(404).json({ error: 'No existe ese medicamento.' });
      res.json(view(med));
    }),
  );

  app.post(
    '/api/medications/:id/log',
    h((req, res) => {
      const uid = userId(req);
      const med = medicationsModel.getById(uid, Number(req.params.id));
      if (!med) return void res.status(404).json({ error: 'No existe ese medicamento.' });
      const day = date(req.body?.date) ?? todayLocal();
      logMedicationAnswer(uid, med, day, req.body?.taken !== false, 'web');
      res.json(view(med));
    }),
  );

  app.delete(
    '/api/medications/:id',
    h((req, res) => {
      medicationsModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
