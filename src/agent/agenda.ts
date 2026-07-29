import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { todayLocal, weekdayName, dateOnly, nowLocal, addDays } from '../util/datetime.js';
import { env } from '../config/env.js';

interface AgendaItem {
  time: string; // 'HH:mm'
  label: string;
}

/**
 * Builds today's ordered agenda (routines + today's one-off reminders, sorted by time, plus
 * today's no-fixed-time todos at the end) for a user. Used both by the on-demand
 * get_today_agenda tool and the automatic morning ping (kind: 'daily_agenda' reminder - see
 * task-scheduler.ts). Built fresh on every call so it's always accurate: a routine already
 * checked in today shows as done instead of being asked about again (point behind why the bot
 * used to nag after an early check-in), and a routine whose time already passed without a
 * check-in is flagged so the user can ask to move it to another slot the same day (edit_routine).
 */
export function buildAgendaMessage(userId: number): string {
  const today = todayLocal();
  const now = nowLocal();
  const items: AgendaItem[] = [];

  const routines = todosRepo.list(userId, { scope: 'routine' });
  for (const r of routines) {
    if (!r.reminder_time) continue;
    const log = habitLogsRepo.getForDate(r.id, today);
    const runAt = `${today} ${r.reminder_time}:00`;
    let note = '';
    if (log?.done) note = ' — ✅ ya cumplida hoy';
    else if (runAt < now) note = ' — ⚠️ ya pasó la hora y no está marcada (puedo reprogramarla con edit_routine si quieres)';
    items.push({ time: r.reminder_time, label: `${r.title} (rutina)${note}` });
  }

  const reminders = remindersRepo
    .listAll(userId, 'pending')
    .filter(
      (rem) =>
        (rem.kind === 'reminder' || rem.kind === 'important_date' || rem.kind === 'flexible') &&
        dateOnly(rem.run_at) === today,
    );
  for (const rem of reminders) {
    items.push({ time: rem.run_at.slice(11, 16), label: rem.message });
  }

  items.sort((a, b) => a.time.localeCompare(b.time));

  const todosToday = todosRepo.list(userId, { scope: 'today', status: 'pending' });

  const lines: string[] = [`📋 Tu día de hoy (${today}, ${weekdayName(today)}):`];

  if (items.length === 0 && todosToday.length === 0) {
    lines.push('', 'No tienes nada agendado para hoy. 🎉');
    return lines.join('\n');
  }

  if (items.length > 0) {
    lines.push('', `Para empezar: ${items[0].time} — ${items[0].label}`, '');
    for (const it of items) lines.push(`⏰ ${it.time} ${it.label}`);
  }

  if (todosToday.length > 0) {
    lines.push('', 'Sin hora fija:');
    for (const t of todosToday) lines.push(`- #${t.id} ${t.title}`);
  }

  return lines.join('\n');
}

/**
 * Creates the recurring "daily_agenda" reminder for a user if they don't already have one -
 * called once on bootstrap (admin's first message, see bot-manager.ts) and once per new user
 * (grant_access.tool.ts). Fires daily at MORNING_SUMMARY_TIME; content is built fresh at send
 * time by buildAgendaMessage() above (see task-scheduler.ts), not stored here. Idempotent, so
 * it's safe to call on every bootstrap without risking a duplicate morning ping.
 */
export function ensureDailyAgendaReminder(userId: number, targetJid: string): void {
  const already = remindersRepo.listAll(userId).some((r) => r.kind === 'daily_agenda');
  if (already) return;

  const [h, m] = env.morningSummaryTime.split(':').map(Number);
  const hh = String(h ?? 6).padStart(2, '0');
  const mm = String(m ?? 30).padStart(2, '0');
  let runAt = `${todayLocal()} ${hh}:${mm}:00`;
  if (runAt <= nowLocal()) runAt = `${addDays(todayLocal(), 1).slice(0, 10)} ${hh}:${mm}:00`;

  remindersRepo.create(userId, {
    message: 'Agenda del día', // unused at send time - buildAgendaMessage() generates it fresh
    runAt,
    targetJid,
    categoryId: null,
    recurrenceFreq: 'daily',
    recurrenceInterval: 1,
    kind: 'daily_agenda',
  });
  console.log('[AGENDA] Aviso matutino diario programado para el usuario #%d a las %s:%s.', userId, hh, mm);
}
