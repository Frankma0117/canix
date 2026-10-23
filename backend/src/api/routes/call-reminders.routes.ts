import { type Express } from 'express';
import { callRemindersModel } from '../../models/call-reminders.model.js';
import { createCallReminder, updateCallReminder, testCallNow } from '../../services/calls/call-reminders.service.js';
import { nowLocal } from '../../shared/utils/datetime.js';
import { h, userId } from '../http-helpers.js';
import type { RecurrenceFreq, CallReminderStatus } from '../../entities/index.js';

/** Phone-call reminders and alarms (Twilio). */
export function registerCallReminderRoutes(app: Express): void {
  // A separate resource from /api/reminders above (different channel, fields, and status
  // vocabulary - see call-reminders.model.ts's own comment) - same panel auth (resolvePanelUser
  // already ran for every /api route), so every call reminder is scoped to whoever created it.
  app.get(
    '/api/call-reminders',
    h((req, res) => {
      const status = req.query.status as CallReminderStatus | undefined;
      res.json(callRemindersModel.listAll(userId(req), status));
    }),
  );
  app.get(
    '/api/call-reminders/:id',
    h((req, res) => {
      const reminder = callRemindersModel.getById(userId(req), Number(req.params.id));
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });
      res.json(reminder);
    }),
  );
  app.post(
    '/api/call-reminders',
    h((req, res) => {
      const { phone_number, message, call_type, scheduled_at, recurrence_freq, recurrence_interval } = req.body ?? {};
      if (!phone_number || !scheduled_at) {
        return res.status(400).json({ error: 'phone_number y scheduled_at son requeridos' });
      }
      if (call_type && call_type !== 'reminder' && call_type !== 'alarm') {
        return res.status(400).json({ error: 'call_type debe ser "reminder" o "alarm"' });
      }
      const result = createCallReminder({
        userId: userId(req),
        phoneNumber: String(phone_number),
        message: String(message ?? ''),
        callType: call_type === 'alarm' ? 'alarm' : 'reminder',
        scheduledAt: String(scheduled_at),
        recurrenceFreq: recurrence_freq as RecurrenceFreq | undefined,
        recurrenceInterval: recurrence_interval === undefined ? undefined : Number(recurrence_interval),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    }),
  );
  app.put(
    '/api/call-reminders/:id',
    h((req, res) => {
      const { phone_number, message, call_type, scheduled_at, recurrence_freq, recurrence_interval } = req.body ?? {};
      if (call_type && call_type !== 'reminder' && call_type !== 'alarm') {
        return res.status(400).json({ error: 'call_type debe ser "reminder" o "alarm"' });
      }
      const result = updateCallReminder(userId(req), Number(req.params.id), {
        phoneNumber: phone_number === undefined ? undefined : String(phone_number),
        message: message === undefined ? undefined : String(message),
        callType: call_type as 'reminder' | 'alarm' | undefined,
        scheduledAt: scheduled_at === undefined ? undefined : String(scheduled_at),
        recurrenceFreq: recurrence_freq as RecurrenceFreq | undefined,
        recurrenceInterval: recurrence_interval === undefined ? undefined : Number(recurrence_interval),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    }),
  );
  app.post(
    '/api/call-reminders/:id/cancel',
    h((req, res) => {
      const ok = callRemindersModel.cancel(userId(req), Number(req.params.id));
      if (!ok) return res.status(400).json({ error: 'No se puede cancelar (no existe, o ya terminó)' });
      res.json({ ok: true });
    }),
  );
  // Places the call RIGHT NOW using this reminder's own phone/message, as a separate one-off test
  // row (see services/calls/call-reminders.service.ts's testCallNow) - the original scheduled reminder is
  // never touched by this, so testing it doesn't consume/advance its real scheduled occurrence.
  app.post(
    '/api/call-reminders/:id/test',
    h(async (req, res) => {
      const uid = userId(req);
      const reminder = callRemindersModel.getById(uid, Number(req.params.id));
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });

      const result = await testCallNow({
        userId: uid,
        phoneNumber: reminder.phone_number,
        message: reminder.message,
        callType: reminder.call_type,
        scheduledAt: nowLocal(),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    }),
  );
  app.delete(
    '/api/call-reminders/:id',
    h((req, res) => {
      callRemindersModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
