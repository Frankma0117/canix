import { todosModel } from '../../models/todos.model.js';
import { remindersModel } from '../../models/reminders.model.js';
import { db } from '../../database/connection.js';
import { usersModel } from '../../models/users.model.js';
import { addMinutes, nowLocal } from '../../shared/utils/datetime.js';
import { routineStartMessage, routineCheckinMessage } from '../../shared/utils/motivational.js';
import {
  anchorDate,
  nextOccurrence,
  occursOn,
  normalizeWeekdays,
  scheduleOf,
  type RoutineFreq,
  type RoutineSchedule,
} from './routine-schedule.js';
import type { RecurrenceFreq, Reminder, Todo } from '../../entities/index.js';

/** What a caller (chat tool or web portal) may say about when a routine happens. */
export interface RoutineScheduleInput {
  freq?: RoutineFreq;
  /** Every how many days/weeks/months (2 + weekly = "cada 15 días"). */
  interval?: number;
  weekdays?: number[];
  monthDay?: number | null;
  /** 'YYYY-MM-DD' - first day it may happen; default: its next occurrence from now. */
  startDate?: string | null;
}

const TIME_RE = /^\d{1,2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads the schedule fields the chat tools and the portal both send (frequency, interval,
 * weekdays, month_day, start_date) into a RoutineScheduleInput, or returns a message saying what's
 * wrong. Only the keys actually present are set, so it serves edits too.
 */
export function parseScheduleInput(raw: {
  frequency?: unknown;
  interval?: unknown;
  weekdays?: unknown;
  month_day?: unknown;
  start_date?: unknown;
}): RoutineScheduleInput | { error: string } {
  const out: RoutineScheduleInput = {};
  if (raw.frequency !== undefined && raw.frequency !== null && raw.frequency !== '') {
    const f = String(raw.frequency);
    if (f !== 'daily' && f !== 'weekly' && f !== 'monthly') return { error: 'La frecuencia debe ser daily, weekly o monthly.' };
    out.freq = f;
  }
  if (raw.interval !== undefined && raw.interval !== null && raw.interval !== '') {
    const n = Number(raw.interval);
    if (!Number.isInteger(n) || n < 1 || n > 52) return { error: 'El intervalo debe ser un número entero entre 1 y 52.' };
    out.interval = n;
  }
  if (raw.weekdays !== undefined && raw.weekdays !== null) {
    out.weekdays = normalizeWeekdays(raw.weekdays);
    if (Array.isArray(raw.weekdays) && raw.weekdays.length > 0 && out.weekdays.length === 0) {
      return { error: 'No reconocí los días de la semana (usa lunes, martes... o números 0-6, 0 = domingo).' };
    }
  }
  if (raw.month_day !== undefined && raw.month_day !== null && raw.month_day !== '') {
    const d = Number(raw.month_day);
    if (!Number.isInteger(d) || d < 1 || d > 31) return { error: 'El día del mes debe estar entre 1 y 31.' };
    out.monthDay = d;
  }
  if (raw.start_date !== undefined && raw.start_date !== null && raw.start_date !== '') {
    const s = String(raw.start_date);
    if (!DATE_RE.test(s)) return { error: "La fecha de inicio debe ir en formato 'YYYY-MM-DD'." };
    out.startDate = s;
  }
  return out;
}

export function isValidTime(time: string): boolean {
  if (!TIME_RE.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  return h <= 23 && m <= 59;
}

/** Fills in the defaults a schedule needs to be complete (weekly needs days, monthly needs a day). */
function completeSchedule(input: RoutineScheduleInput, time: string, base?: RoutineSchedule): RoutineSchedule {
  const freq = input.freq ?? base?.freq ?? 'daily';
  const today = nowLocal().slice(0, 10);
  const [, , dd] = today.split('-').map(Number);
  const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sameFreq = base?.freq === freq;
  return {
    freq,
    interval: input.interval ?? (sameFreq ? base!.interval : 1),
    weekdays: freq === 'weekly' ? (input.weekdays?.length ? input.weekdays : sameFreq && base!.weekdays.length ? base!.weekdays : [todayWeekday]) : [],
    monthDay: freq === 'monthly' ? (input.monthDay ?? (sameFreq ? base!.monthDay : null) ?? dd) : null,
    startDate: input.startDate ?? null,
    time,
  };
}

function storedFreq(freq: RoutineFreq): RecurrenceFreq {
  return freq;
}

/**
 * Creates a routine todo plus its auto-created reminder pair: the notice at reminder_time (which
 * carries the "¿lo hiciste?" poll, see services/reminders/reminder-prompts.service.ts) and a check-in question
 * duration_minutes later, only sent if that poll couldn't go out. Both linked to the routine
 * (todo_id) so deleting it cascades and removes them too. Shared by the create_routine chat tool
 * and the portal's routine form, so routines behave the same wherever they're created.
 */
export function createRoutineWithReminders(
  userId: number,
  targetJid: string,
  fields: {
    title: string;
    categoryId: number | null;
    reminderTime: string;
    durationMinutes: number;
  } & RoutineScheduleInput,
): number {
  const draft = completeSchedule(fields, fields.reminderTime);
  const schedule: RoutineSchedule = { ...draft, startDate: anchorDate(draft, fields.startDate) };

  const id = todosModel.create(userId, {
    title: fields.title,
    categoryId: fields.categoryId,
    scope: 'routine',
    dueDate: null,
    recurrenceFreq: storedFreq(schedule.freq),
    reminderTime: schedule.time,
    durationMinutes: fields.durationMinutes,
    weekdays: schedule.weekdays.length ? schedule.weekdays.join(',') : null,
    recurrenceInterval: schedule.interval,
    monthDay: schedule.monthDay,
    startDate: schedule.startDate,
  });

  const reminderRunAt = nextOccurrence(schedule, nowLocal()) ?? `${schedule.startDate} ${schedule.time}:00`;
  const base = {
    targetJid,
    categoryId: fields.categoryId,
    recurrenceFreq: storedFreq(schedule.freq),
    recurrenceInterval: schedule.interval,
    todoId: id,
  };
  remindersModel.create(userId, { ...base, message: routineStartMessage(fields.title), runAt: reminderRunAt, kind: 'routine_reminder' });
  remindersModel.create(userId, {
    ...base,
    message: routineCheckinMessage(fields.title),
    runAt: addMinutes(reminderRunAt, fields.durationMinutes),
    kind: 'routine_checkin',
  });

  return id;
}

/**
 * Edits an existing routine in place - title, category, schedule, reminder time and/or duration -
 * instead of requiring a delete + recreate (which used to lose the streak/history since a new todo
 * id starts a fresh habit_logs series). Only the fields passed are changed; when anything about
 * the timing changes, both linked reminders are moved to the routine's next occurrence. Changing
 * only the hour or the duration keeps the anchor (so an every-two-weeks routine stays on the same
 * weeks); changing the days/frequency re-anchors it to its next occurrence. Returns false if the
 * routine doesn't exist (or isn't a routine).
 */
export function updateRoutineWithReminders(
  userId: number,
  id: number,
  fields: {
    title?: string;
    categoryId?: number | null;
    reminderTime?: string;
    durationMinutes?: number;
  } & RoutineScheduleInput,
): boolean {
  const todo = todosModel.getById(userId, id);
  if (!todo || todo.scope !== 'routine') return false;

  const title = fields.title ?? todo.title;
  const categoryId = fields.categoryId === undefined ? todo.category_id : fields.categoryId;
  const durationMinutes = fields.durationMinutes ?? todo.duration_minutes!;
  const current = scheduleOf(todo);
  const time = fields.reminderTime ?? current.time;

  const patternChanged =
    fields.freq !== undefined ||
    fields.interval !== undefined ||
    fields.weekdays !== undefined ||
    fields.monthDay !== undefined ||
    (fields.startDate !== undefined && fields.startDate !== null);
  const timeChanged = patternChanged || fields.reminderTime !== undefined || fields.durationMinutes !== undefined;

  let schedule: RoutineSchedule = { ...current, time };
  if (patternChanged) {
    const draft = completeSchedule(fields, time, current);
    schedule = { ...draft, startDate: anchorDate(draft, fields.startDate) };
  }

  db.prepare(
    `UPDATE todos SET title = ?, category_id = ?, recurrence_freq = ?, reminder_time = ?, duration_minutes = ?,
       weekdays = ?, recurrence_interval = ?, month_day = ?, start_date = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    title,
    categoryId,
    storedFreq(schedule.freq),
    schedule.time,
    durationMinutes,
    schedule.weekdays.length ? schedule.weekdays.join(',') : null,
    schedule.interval,
    schedule.monthDay,
    schedule.startDate,
    id,
    userId,
  );

  const linked = remindersModel.listByTodo(id).filter((r) => r.user_id === userId) as Reminder[];
  const reminderLink = linked.find((r) => r.kind === 'routine_reminder');
  const checkinLink = linked.find((r) => r.kind === 'routine_checkin');

  if (timeChanged) {
    const reminderRunAt = nextOccurrence(schedule, nowLocal());
    if (reminderRunAt) {
      const recurrence = { recurrenceFreq: storedFreq(schedule.freq), recurrenceInterval: schedule.interval, categoryId };
      if (reminderLink) {
        remindersModel.update(userId, reminderLink.id, { ...recurrence, message: routineStartMessage(title), runAt: reminderRunAt });
      }
      if (checkinLink) {
        remindersModel.update(userId, checkinLink.id, {
          ...recurrence,
          message: routineCheckinMessage(title),
          runAt: addMinutes(reminderRunAt, durationMinutes),
        });
      }
    }
  } else {
    // Only title/category changed - keep the existing run_at, just refresh the wording/category.
    if (reminderLink) {
      remindersModel.update(userId, reminderLink.id, { message: routineStartMessage(title), categoryId });
    }
    if (checkinLink) {
      remindersModel.update(userId, checkinLink.id, { message: routineCheckinMessage(title), categoryId });
    }
  }

  return true;
}

/**
 * Next run of a routine's linked reminder after the occurrence it just handled - the routine's own
 * schedule decides (weekdays, every N weeks, monthly), not the reminder row's plain "add N days".
 * The check-in sits duration_minutes after each occurrence. Returns undefined when the routine
 * can't be read, so the caller falls back to the generic recurrence.
 */
export function nextRoutineRunAt(reminder: Pick<Reminder, 'kind' | 'todo_id' | 'user_id' | 'run_at'>): string | undefined {
  if (!reminder.todo_id) return undefined;
  const todo = todosModel.getById(reminder.user_id, reminder.todo_id) as Todo | undefined;
  if (!todo || todo.scope !== 'routine' || !todo.reminder_time) return undefined;
  const schedule = scheduleOf(todo);
  const offset = reminder.kind === 'routine_checkin' ? (todo.duration_minutes ?? 0) : 0;
  // The occurrence just handled may have been moved for the day (see moveRoutineToday): when it went
  // out EARLIER than the routine's own hour, that day's regular hour is the same occurrence, not a
  // new one - the next is the following day's.
  const handled = addMinutes(reminder.run_at, -offset);
  const regular = `${handled.slice(0, 10)} ${schedule.time}:00`;
  const after = regular > handled && occursOn(schedule, handled.slice(0, 10)) ? regular : handled;
  const next = nextOccurrence(schedule, after);
  return next ? addMinutes(next, offset) : undefined;
}

/**
 * Pauses (or, with `until: null`, resumes) a routine's notifications by setting paused_until on
 * BOTH its linked reminders (routine_reminder + routine_checkin) together - a routine's pause is
 * one shared concept, not two independent ones, so both rows always move in lockstep. Returns
 * false if the routine doesn't exist (or isn't a routine).
 */
export function setRoutinePaused(userId: number, id: number, until: string | null): boolean {
  const todo = todosModel.getById(userId, id);
  if (!todo || todo.scope !== 'routine') return false;

  const linked = remindersModel.listByTodo(id).filter((r) => r.user_id === userId);
  for (const r of linked) remindersModel.setPausedUntil(userId, r.id, until);
  return true;
}

/**
 * Moves ONLY the next notice of a routine to another hour today ("hoy no alcancé, pásala a las 6"),
 * leaving the routine's own hour alone: after that notice goes out, the next one is computed from
 * the routine's schedule again (see nextRoutineRunAt), so tomorrow it's back at its usual time.
 * Before this existed, "reprogramar" changed the routine's hour for good - and a few of those left
 * a morning routine living at midday. Returns the new notice time, or an error text.
 */
export function moveRoutineToday(userId: number, id: number, time: string): { runAt: string } | { error: string } {
  const todo = todosModel.getById(userId, id);
  if (!todo || todo.scope !== 'routine') return { error: `No encontré la rutina ⟦${id}⟧.` };
  if (!isValidTime(time)) return { error: "La hora tiene que ir en formato 'HH:mm'." };
  const [h, m] = time.split(':').map(Number);
  const runAt = `${nowLocal().slice(0, 10)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  if (runAt <= nowLocal()) return { error: `Las ${time} de hoy ya pasaron (ahora son ${nowLocal().slice(11, 16)}). Pregúntale a qué hora de hoy la quiere.` };

  ensureRoutineReminders(userId, id);
  const linked = remindersModel.listByTodo(id).filter((r) => r.user_id === userId);
  const notice = linked.find((r) => r.kind === 'routine_reminder');
  const checkin = linked.find((r) => r.kind === 'routine_checkin');
  if (notice) remindersModel.update(userId, notice.id, { runAt });
  if (checkin) remindersModel.update(userId, checkin.id, { runAt: addMinutes(runAt, todo.duration_minutes ?? 0) });
  return { runAt };
}

/** True when the routine has a live notice (pending or just suspended for lack of answers). */
export function routineNotifies(todoId: number): boolean {
  return remindersModel.listByTodo(todoId).some((r) => r.kind === 'routine_reminder' && (r.status === 'pending' || r.status === 'suspended'));
}

/**
 * Makes sure a routine has its notice + check-in pair alive: creates the rows if they're gone and
 * puts them back to pending at the routine's next occurrence if they were left cancelled/finished.
 * A routine without them shows up everywhere as a routine but never says a word - which happened
 * to several (their rows were cancelled or deleted by tools that didn't guard routine rows yet).
 * Returns true if anything had to be repaired.
 */
export function ensureRoutineReminders(userId: number, id: number): boolean {
  const todo = todosModel.getById(userId, id);
  const owner = usersModel.getById(userId);
  if (!todo || todo.scope !== 'routine' || !todo.reminder_time || !owner) return false;
  const schedule = scheduleOf(todo);
  const next = nextOccurrence(schedule, nowLocal());
  if (!next) return false;

  const linked = remindersModel.listByTodo(id).filter((r) => r.user_id === userId);
  const alive = (status: string) => status === 'pending' || status === 'suspended';
  let repaired = false;
  const pair: [Reminder['kind'], string, string][] = [
    ['routine_reminder', routineStartMessage(todo.title), next],
    ['routine_checkin', routineCheckinMessage(todo.title), addMinutes(next, todo.duration_minutes ?? 0)],
  ];
  for (const [kind, message, runAt] of pair) {
    const row = linked.find((r) => r.kind === kind);
    if (row && alive(row.status)) continue;
    repaired = true;
    if (row) {
      remindersModel.update(userId, row.id, { message, runAt, recurrenceFreq: schedule.freq, recurrenceInterval: schedule.interval });
      remindersModel.setConfirmationState(row.id, false, 0);
    } else {
      remindersModel.create(userId, { message, runAt, targetJid: owner.jid, categoryId: todo.category_id, recurrenceFreq: schedule.freq, recurrenceInterval: schedule.interval, kind, todoId: id });
    }
  }
  return repaired;
}
