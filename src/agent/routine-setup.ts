import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { db } from '../db/pool.js';
import { todayLocal, addMinutes, addDays, parseWall, nowLocal } from '../util/datetime.js';
import type { RecurrenceFreq, Reminder } from '../types/index.js';

/** Pushes a same-day run_at forward one cycle if it's already in the past, so a routine set up
 *  mid-day doesn't immediately fire for a reminder_time that already happened today. */
function firstFutureOccurrence(runAt: string, freq: RecurrenceFreq): string {
  if (parseWall(runAt) > parseWall(nowLocal())) return runAt;
  return freq === 'weekly' ? addDays(runAt, 7) : addDays(runAt, 1);
}

/**
 * Creates a routine todo plus its auto-created reminder pair: a heads-up at reminder_time, and a
 * check-in prompt reminder_time + duration_minutes later. Both linked to the routine (todo_id) so
 * deleting it cascades and removes them too. Shared by the create_routine chat tool and the admin
 * panel's routine form, so routines behave the same regardless of where they're created.
 */
export function createRoutineWithReminders(
  userId: number,
  targetJid: string,
  fields: {
    title: string;
    categoryId: number | null;
    freq: RecurrenceFreq;
    reminderTime: string;
    durationMinutes: number;
  },
): number {
  const id = todosRepo.create(userId, {
    title: fields.title,
    categoryId: fields.categoryId,
    scope: 'routine',
    dueDate: null,
    recurrenceFreq: fields.freq,
    reminderTime: fields.reminderTime,
    durationMinutes: fields.durationMinutes,
  });

  const [h, m] = fields.reminderTime.split(':').map(Number);
  const todayAtReminderTime = `${todayLocal()} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const reminderRunAt = firstFutureOccurrence(todayAtReminderTime, fields.freq);
  const checkinRunAt = addMinutes(reminderRunAt, fields.durationMinutes);

  remindersRepo.create(userId, {
    message: `⏰ Hora de: ${fields.title}`,
    runAt: reminderRunAt,
    targetJid,
    categoryId: fields.categoryId,
    recurrenceFreq: fields.freq,
    recurrenceInterval: 1,
    kind: 'routine_reminder',
    todoId: id,
  });
  remindersRepo.create(userId, {
    message: `✅ ¿Cumpliste con "${fields.title}"? Cuéntame para marcarlo (rutina #${id}).`,
    runAt: checkinRunAt,
    targetJid,
    categoryId: fields.categoryId,
    recurrenceFreq: fields.freq,
    recurrenceInterval: 1,
    kind: 'routine_checkin',
    todoId: id,
  });

  return id;
}

/**
 * Edits an existing routine in place - title, category, frequency, reminder time and/or duration -
 * instead of requiring a delete + recreate (which used to lose the streak/history since a new todo
 * id starts a fresh habit_logs series). Only the fields passed are changed; when reminder_time,
 * duration_minutes or freq changes, both linked reminders (routine_reminder/routine_checkin) are
 * recomputed the same way createRoutineWithReminders does it, so the new schedule takes effect
 * from the next occurrence on. Returns false if the routine doesn't exist (or isn't a routine).
 */
export function updateRoutineWithReminders(
  userId: number,
  id: number,
  fields: {
    title?: string;
    categoryId?: number | null;
    freq?: RecurrenceFreq;
    reminderTime?: string;
    durationMinutes?: number;
  },
): boolean {
  const todo = todosRepo.getById(userId, id);
  if (!todo || todo.scope !== 'routine') return false;

  const title = fields.title ?? todo.title;
  const categoryId = fields.categoryId === undefined ? todo.category_id : fields.categoryId;
  const freq = fields.freq ?? (todo.recurrence_freq as RecurrenceFreq);
  const reminderTime = fields.reminderTime ?? todo.reminder_time!;
  const durationMinutes = fields.durationMinutes ?? todo.duration_minutes!;

  db.prepare(
    `UPDATE todos SET title = ?, category_id = ?, recurrence_freq = ?, reminder_time = ?, duration_minutes = ?
     WHERE id = ? AND user_id = ?`,
  ).run(title, categoryId, freq, reminderTime, durationMinutes, id, userId);

  const timeChanged = fields.reminderTime !== undefined || fields.durationMinutes !== undefined || fields.freq !== undefined;
  const linked = remindersRepo.listByTodo(id).filter((r) => r.user_id === userId) as Reminder[];
  const reminderLink = linked.find((r) => r.kind === 'routine_reminder');
  const checkinLink = linked.find((r) => r.kind === 'routine_checkin');

  if (timeChanged) {
    const [h, m] = reminderTime.split(':').map(Number);
    const todayAtReminderTime = `${todayLocal()} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    const reminderRunAt = firstFutureOccurrence(todayAtReminderTime, freq);
    const checkinRunAt = addMinutes(reminderRunAt, durationMinutes);
    if (reminderLink) {
      remindersRepo.update(userId, reminderLink.id, {
        message: `⏰ Hora de: ${title}`,
        runAt: reminderRunAt,
        categoryId,
        recurrenceFreq: freq,
      });
    }
    if (checkinLink) {
      remindersRepo.update(userId, checkinLink.id, {
        message: `✅ ¿Cumpliste con "${title}"? Cuéntame para marcarlo (rutina #${id}).`,
        runAt: checkinRunAt,
        categoryId,
        recurrenceFreq: freq,
      });
    }
  } else {
    // Only title/category changed - keep the existing run_at, just refresh the wording/category.
    if (reminderLink) {
      remindersRepo.update(userId, reminderLink.id, { message: `⏰ Hora de: ${title}`, categoryId });
    }
    if (checkinLink) {
      remindersRepo.update(userId, checkinLink.id, {
        message: `✅ ¿Cumpliste con "${title}"? Cuéntame para marcarlo (rutina #${id}).`,
        categoryId,
      });
    }
  }

  return true;
}
