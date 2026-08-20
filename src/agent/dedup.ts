import { db } from '../db/pool.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { todayLocal, nowLocal, addDays } from '../util/datetime.js';
import { stripKnownPrefix } from '../util/motivational.js';
import { env } from '../config/env.js';
import type { Reminder, ReminderKind, Todo } from '../types/index.js';

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Matches a trailing time-of-day tag some reminders get worded with (e.g. "Hora de tomar tu
// apixaban (mañana)" vs "Hora de tomar tu apixaban") - two reminders that only differ by this tag
// are the exact "same thing, said slightly differently" duplicate reported in practice (a
// medication reminder created once as "...", once as "... (mañana)"), so it's stripped before
// comparing, same idea as stripKnownPrefix() below for the random emoji lead-in.
const TIME_OF_DAY_SUFFIX_RE = /\s*\((madrugada|ma[nñ]ana|tarde|noche)\)\s*$/i;

/** Normalizes a reminder's message for duplicate comparison ONLY (not for display) - strips the
 *  random emoji prefix some kinds bake in at creation (stripKnownPrefix) and a trailing "(mañana)"/
 *  "(tarde)"/"(noche)"/"(madrugada)" tag, then case/whitespace-folds what's left. Deliberately a
 *  separate function from normalize() above (used for routine titles too) - collapsing that same
 *  suffix there could wrongly merge two routines the user made distinct ON PURPOSE, like "Yoga
 *  (mañana)" and "Yoga (noche)" as two different daily habits; a reminder has no such legitimate
 *  "same title, different time-of-day tag, both intentional" case since the tag itself is only ever
 *  decorative wording, never data. */
function normalizeReminderMessage(message: string): string {
  return normalize(stripKnownPrefix(message).replace(TIME_OF_DAY_SUFFIX_RE, ''));
}

/**
 * Duplicate-detection key for a reminder-like set of fields - two reminders are duplicates iff they
 * share kind + target_jid + recurrence_freq/interval + the same normalized message + the same
 * time-of-day (+ same calendar date for a true one-off, since two distinct one-off reminders on
 * different days aren't duplicates just for sharing a clock time) + the same window for `flexible`.
 * Exported so both the nightly sweep (dedupeReminders below) and schedule_reminder's own
 * create-time check (see schedule-reminder.tool.ts) use the exact same definition of "duplicate" -
 * catching it at creation is strictly better (the user never even sees the double-fire), the nightly
 * sweep stays as the safety net for whatever slips through (a race, a kind this check doesn't cover).
 */
export function reminderDedupeKey(r: {
  kind: ReminderKind;
  target_jid: string | null;
  recurrence_freq: string;
  recurrence_interval: number;
  message: string;
  run_at: string;
  window_start?: string | null;
  window_end?: string | null;
}): string {
  return [
    r.kind,
    r.target_jid ?? '',
    r.recurrence_freq,
    r.recurrence_interval,
    normalizeReminderMessage(r.message),
    r.run_at.slice(11, 16),
    r.recurrence_freq === 'none' ? r.run_at.slice(0, 10) : '',
    r.kind === 'flexible' ? `${r.window_start ?? ''}-${r.window_end ?? ''}` : '',
  ].join('|');
}

/**
 * Creates the recurring "daily_dedup" reminder for a user if they don't already have one - same
 * idempotent-bootstrap pattern as ensureDailyAgendaReminder (see agent/agenda.ts), called from the
 * same three registration points. Fires daily at DAILY_DEDUP_TIME; task-scheduler.ts handles this
 * kind by silently running dedupeUser() below - no WhatsApp message is ever sent, this is purely
 * internal housekeeping ("no es necesario repetir las cosas").
 */
export function ensureDailyDedupReminder(userId: number, targetJid: string): void {
  const already = remindersRepo.listAll(userId).some((r) => r.kind === 'daily_dedup');
  if (already) return;

  const [h, m] = env.dailyDedupTime.split(':').map(Number);
  const hh = String(h ?? 4).padStart(2, '0');
  const mm = String(m ?? 10).padStart(2, '0');
  let runAt = `${todayLocal()} ${hh}:${mm}:00`;
  if (runAt <= nowLocal()) runAt = `${addDays(todayLocal(), 1).slice(0, 10)} ${hh}:${mm}:00`;

  remindersRepo.create(userId, {
    message: 'Limpieza diaria de duplicados', // unused at send time - never actually sent
    runAt,
    targetJid,
    categoryId: null,
    recurrenceFreq: 'daily',
    recurrenceInterval: 1,
    kind: 'daily_dedup',
  });
  console.log('[DEDUP] Limpieza diaria de duplicados programada para el usuario #%d a las %s:%s.', userId, hh, mm);
}

/**
 * Scans one user's routines and reminders for duplicates and keeps only one of each, run once a
 * day (see ensureDailyDedupReminder above / task-scheduler.ts). Scoped per-user only - data is
 * already fully isolated per user, a cross-user pass makes no sense here. Wrapped in a single
 * transaction (same idiom as db/reset-user.ts) so a mid-pass crash can't leave a half-merged state.
 */
export function dedupeUser(userId: number): { routinesMerged: number; remindersRemoved: number } {
  let routinesMerged = 0;
  let remindersRemoved = 0;
  const tx = db.transaction(() => {
    routinesMerged = dedupeRoutines(userId);
    remindersRemoved = dedupeReminders(userId);
  });
  tx();
  return { routinesMerged, remindersRemoved };
}

/**
 * Two routines are duplicates iff they match on title (normalized) + recurrence_freq +
 * reminder_time + duration_minutes ALL together - matching on title alone risks merging two
 * routines that just happen to share a name but have a meaningfully different schedule. Keeps the
 * one with the most habit_logs history (richest tracked streak, not just "oldest") so a duplicate
 * created later doesn't wipe out a well-tracked routine just for being younger; the losing
 * duplicate's own history is merged into the survivor first (INSERT OR IGNORE respects the
 * existing UNIQUE(todo_id, log_date), so a genuine same-day conflict just keeps the survivor's
 * entry) before todosRepo.remove() cascades it away.
 */
function dedupeRoutines(userId: number): number {
  const routines = todosRepo.list(userId, { scope: 'routine' });
  const groups = new Map<string, Todo[]>();
  for (const r of routines) {
    const key = [normalize(r.title), r.recurrence_freq, r.reminder_time, r.duration_minutes].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const withCounts = group.map((todo) => ({
      todo,
      count: (db.prepare('SELECT COUNT(*) AS c FROM habit_logs WHERE todo_id = ?').get(todo.id) as { c: number }).c,
    }));
    withCounts.sort((a, b) => b.count - a.count || a.todo.id - b.todo.id);
    const survivor = withCounts[0].todo;
    for (const { todo: loser } of withCounts.slice(1)) {
      db.prepare(
        `INSERT OR IGNORE INTO habit_logs (todo_id, log_date, done, note)
         SELECT ?, log_date, done, note FROM habit_logs WHERE todo_id = ?`,
      ).run(survivor.id, loser.id);
      todosRepo.remove(userId, loser.id); // cascades: merged habit_logs rows, its own routine_reminder/routine_checkin pair
      merged += 1;
    }
  }
  return merged;
}

// routine_reminder/routine_checkin are handled as a byproduct of dedupeRoutines above;
// daily_agenda/weekly_report/daily_reset/daily_dedup are already structurally single-per-user via
// their own ensureX idempotency guard; interval reminders are short-lived/self-terminating, "same
// content" has no meaningful duplicate concept mid-timer.
const DEDUPABLE_KINDS: ReminderKind[] = ['reminder', 'important_date', 'flexible'];

/**
 * Two reminders are duplicates iff reminderDedupeKey() (above) matches - see that function for the
 * exact fields compared. Keeps the oldest (lowest id) - reminders carry no per-row history worth
 * preserving the way a routine's habit_logs does, so "oldest wins" is safe and simple here.
 */
function dedupeReminders(userId: number): number {
  const reminders = remindersRepo.listAll(userId, 'pending').filter((r) => DEDUPABLE_KINDS.includes(r.kind));
  const groups = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const key = reminderDedupeKey(r);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const loser of sorted.slice(1)) {
      remindersRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}
