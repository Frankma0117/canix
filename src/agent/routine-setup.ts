import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { todayLocal, addMinutes, addDays, parseWall, nowLocal } from '../util/datetime.js';
import type { RecurrenceFreq } from '../types/index.js';

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
