import { USER_REMINDER_KINDS } from '../../services/reminders/reminder-kinds.js';
import { type Express } from 'express';
import { remindersModel } from '../../models/reminders.model.js';
import { iconFor } from '../../shared/utils/icons.js';
import { stripKnownPrefix } from '../../shared/utils/motivational.js';
import { h, ownCategoryId, userId } from '../http-helpers.js';
import type { ReminderStatus } from '../../entities/index.js';

/** WhatsApp reminders (one-off, recurring, important dates, flexible, interval). */
export function registerReminderRoutes(app: Express): void {
  app.get(
    '/api/reminders',
    h((req, res) => {
      const status = req.query.status as ReminderStatus | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      const uid = userId(req);
      const rows = categoryId ? remindersModel.listByCategory(uid, categoryId, status) : remindersModel.listAll(uid, status);
      // Only what the person thinks of as a reminder: a routine's own notice/check-in rows belong
      // to Rutinas, and the silent housekeeping ones (daily reset, dedup, weekly report) to nobody.
      res.json(
        rows
          .filter((r) => USER_REMINDER_KINDS.has(r.kind))
          .map((r) => ({ ...r, message: stripKnownPrefix(r.message), icon: iconFor(stripKnownPrefix(r.message), '🔔') })),
      );
    }),
  );
  app.put(
    '/api/reminders/:id',
    h((req, res) => {
      const uid = userId(req);
      const id = Number(req.params.id);
      const reminder = remindersModel.getById(uid, id);
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });
      if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin' || reminder.kind === 'daily_agenda') {
        return res.status(400).json({ error: 'Este recordatorio pertenece a una rutina o es automático - edítalo desde su rutina' });
      }
      const { message, run_at, category_id, recurrence_freq, recurrence_interval } = req.body ?? {};
      remindersModel.update(uid, id, {
        message: message || undefined,
        runAt: run_at || undefined,
        categoryId: ownCategoryId(req, category_id),
        recurrenceFreq: recurrence_freq || undefined,
        recurrenceInterval: recurrence_interval === undefined ? undefined : Number(recurrence_interval),
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/reminders/:id/cancel',
    h((req, res) => {
      remindersModel.cancel(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/reminders/:id',
    h((req, res) => {
      remindersModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
