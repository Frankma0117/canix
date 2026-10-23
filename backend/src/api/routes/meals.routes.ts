import type { Express, Request } from 'express';
import { mealPlansModel } from '../../models/meal-plans.model.js';
import { syncMealReminders } from '../../services/meals/meal-reminders.service.js';
import { addDays, todayLocal } from '../../shared/utils/datetime.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, userId, str, int } from '../http-helpers.js';
import type { MealSlot } from '../../entities/index.js';

const MEAL_SLOTS: MealSlot[] = ['desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'HH:mm' or cleared: undefined = not sent, null = no time (no notices). */
function mealTime(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const t = String(value ?? '').trim();
  if (!t) return null;
  const padded = /^\d:\d{2}$/.test(t) ? `0${t}` : t;
  return TIME_RE.test(padded) ? padded : undefined;
}

/** Minutes before the meal for the "toca preparar" notice; 0 / empty = none. */
function prepMinutes(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  const n = int(value);
  return n && n > 0 ? Math.min(n, 600) : null;
}

/** Fields of a request body (undefined = not sent). */
function fieldsFrom(req: Request) {
  const b = req.body ?? {};
  const slot = String(b.meal_slot ?? '') as MealSlot;
  return {
    planDate: DATE_RE.test(String(b.plan_date ?? '')) ? String(b.plan_date) : undefined,
    mealSlot: MEAL_SLOTS.includes(slot) ? slot : undefined,
    title: str(b.title, 200) || undefined,
    notes: b.notes === undefined ? undefined : str(b.notes, 500) || null,
    mealTime: mealTime(b.meal_time),
    prepMinutes: prepMinutes(b.prep_minutes),
  };
}

/** The meal plan (breakfast to dinner, by date); a meal with a time gets its notices. */
export function registerMealRoutes(app: Express): void {
  app.use('/api/meals', requirePermission('meals.manage'));
  app.get(
    '/api/meals',
    h((req, res) => {
      const from = DATE_RE.test(String(req.query.from ?? '')) ? String(req.query.from) : todayLocal();
      const to = DATE_RE.test(String(req.query.to ?? '')) ? String(req.query.to) : addDays(from, 13).slice(0, 10);
      res.json(mealPlansModel.listRange(userId(req), from, to));
    }),
  );
  app.post(
    '/api/meals',
    h((req, res) => {
      const f = fieldsFrom(req);
      if (!f.planDate || !f.mealSlot || !f.title) return void res.status(400).json({ error: 'Fecha, comida y plato son requeridos.' });
      const uid = userId(req);
      const id = mealPlansModel.create(uid, { planDate: f.planDate, mealSlot: f.mealSlot, title: f.title, notes: f.notes ?? null, mealTime: f.mealTime, prepMinutes: f.prepMinutes });
      res.status(201).json({ id, notices: syncMealReminders(uid, id) });
    }),
  );
  app.put(
    '/api/meals/:id',
    h((req, res) => {
      const uid = userId(req);
      const id = Number(req.params.id);
      if (!mealPlansModel.getById(uid, id)) return void res.status(404).json({ error: 'No existe esa comida.' });
      mealPlansModel.update(uid, id, fieldsFrom(req));
      res.json({ ...mealPlansModel.getById(uid, id), notices: syncMealReminders(uid, id) });
    }),
  );
  app.delete(
    '/api/meals/:id',
    h((req, res) => {
      mealPlansModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
