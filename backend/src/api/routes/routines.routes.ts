import { type Express } from 'express';
import { remindersModel } from '../../models/reminders.model.js';
import { todosModel } from '../../models/todos.model.js';
import { habitLogsModel } from '../../models/habit-logs.model.js';
import { parseScheduleInput, ensureRoutineReminders } from '../../services/routines/routine-setup.service.js';
import { describeSchedule, occursOn, routineStreak, scheduleOf } from '../../services/routines/routine-schedule.js';
import { logRoutineAnswer } from '../../services/reminders/reminder-prompts.service.js';
import { reminderPromptsModel } from '../../models/reminder-prompts.model.js';
import { iconFor } from '../../shared/utils/icons.js';
import { todayLocal, nowLocal } from '../../shared/utils/datetime.js';
import { h, userId } from '../http-helpers.js';
import type { Todo } from '../../entities/index.js';

/** The schedule fields of a routine as the portal sends them (see services/routines/routine-setup.service.ts). */
export function routineScheduleFromBody(body: Record<string, unknown> | undefined) {
  return parseScheduleInput({
    frequency: body?.recurrence_freq,
    interval: body?.recurrence_interval,
    weekdays: body?.weekdays,
    month_day: body?.month_day,
    start_date: body?.start_date,
  });
}

/**
 * A routine with its schedule spelled out, whether it's due today, today's answer, streak, next
 * notice and pause - what the Rutinas and Ejercicios pages show for each one.
 */
export function routineView(t: Todo, today: string = todayLocal(), now: string = nowLocal()) {
  const schedule = scheduleOf(t);
  const linked = remindersModel.listByTodo(t.id);
  const notice = linked.find((r) => r.kind === 'routine_reminder');
  const pausedUntil = linked.map((r) => r.paused_until).find((p) => p && p > now) ?? null;
  const log = habitLogsModel.getForDate(t.id, today);
  const prompt = reminderPromptsModel.findForRoutineDate(t.id, today);
  return {
    id: t.id,
    title: t.title,
    icon: iconFor(t.title),
    workout_kind: t.workout_kind,
    category_id: t.category_id,
    reminder_time: schedule.time,
    duration_minutes: t.duration_minutes,
    freq: schedule.freq,
    interval: schedule.interval,
    weekdays: schedule.weekdays,
    month_day: schedule.monthDay,
    start_date: t.start_date,
    schedule_label: describeSchedule(schedule),
    occurs_today: occursOn(schedule, today),
    today_answer: log ? (log.done ? 'yes' : 'no') : null,
    today_answered_at: prompt?.answered_at ?? null,
    today_sent_at: prompt?.sent_at ?? null,
    streak: routineStreak(t, today),
    next_run_at: notice && notice.status === 'pending' ? notice.run_at : null,
    suspended: notice?.status === 'suspended',
    notifying: !!notice && (notice.status === 'pending' || notice.status === 'suspended'),
    paused_until: pausedUntil,
  };
}

/** Routines: check-ins, history, answers and the ready-to-show routine list. */
export function registerRoutineRoutes(app: Express): void {
  // habit_logs rows are keyed by todo_id alone (no user_id column) - ownership must be checked via
  // the parent todo before touching them, otherwise one client could read/edit another's habit
  // history just by guessing/incrementing a todo id. Harmless back when the panel was admin-only
  // (there was only ever one possible owner), a real cross-tenant leak now that every client has a
  // token (see resolvePanelUser in api/middleware/auth.middleware.ts).
  app.get(
    '/api/todos/:id/history',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!todosModel.getById(userId(req), id)) return res.status(404).json({ error: 'No existe esa rutina' });
      const days = req.query.days ? Number(req.query.days) : 30;
      res.json({
        history: habitLogsModel.history(id, days),
        streak: routineStreak(todosModel.getById(userId(req), id)!, todayLocal()),
      });
    }),
  );
  app.post(
    '/api/todos/:id/checkin',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!todosModel.getById(userId(req), id)) return res.status(404).json({ error: 'No existe esa rutina' });
      const { date, done, note } = req.body ?? {};
      const logDate = date || todayLocal();
      habitLogsModel.checkIn(id, logDate, done !== false, note || null);
      logRoutineAnswer(userId(req), id, logDate, done !== false, 'web');
      res.json({ ok: true });
    }),
  );
  // Brings a routine's notices back (see ensureRoutineReminders) when they were left cancelled or missing.
  app.post(
    '/api/todos/:id/reactivate',
    h((req, res) => {
      const id = Number(req.params.id);
      const todo = todosModel.getById(userId(req), id);
      if (!todo || todo.scope !== 'routine') return res.status(404).json({ error: 'No existe esa rutina' });
      ensureRoutineReminders(userId(req), id);
      res.json({ ok: true });
    }),
  );
  // Every "¿lo hiciste?" of a routine with its answers in order (see services/reminders/reminder-prompts.service.ts).
  app.get(
    '/api/todos/:id/responses',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!todosModel.getById(userId(req), id)) return res.status(404).json({ error: 'No existe esa rutina' });
      res.json(reminderPromptsModel.listWithResponses(userId(req), { todoId: id, limit: Number(req.query.limit) || 30 }));
    }),
  );
  // Same, across everything this person was asked (routines and plain reminders).
  app.get(
    '/api/reminder-responses',
    h((req, res) => res.json(reminderPromptsModel.listWithResponses(userId(req), { limit: Number(req.query.limit) || 50 }))),
  );

  // Each routine with its schedule spelled out, whether it's due today, today's answer, streak,
  // next notice and pause - so the portal can group them by day/frequency without a request per row.
  app.get(
    '/api/routines',
    h((req, res) => {
      const uid = userId(req);
      const today = todayLocal();
      const now = nowLocal();
      res.json(todosModel.list(uid, { scope: 'routine' }).map((t) => routineView(t, today, now)));
    }),
  );
}
