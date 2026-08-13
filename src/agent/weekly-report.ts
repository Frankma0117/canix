import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { todayLocal, nowLocal, addDays, parseWall, weekdayName } from '../util/datetime.js';
import { env } from '../config/env.js';

/**
 * Builds the weekly report (routines vs one-time tasks, segmented as asked) for a user - the
 * "how many of the week's pending stuff did I actually finish" counterpart to the daily agenda
 * (see agenda.ts's buildAgendaMessage, same "built fresh at send time" pattern). Covers the 7-day
 * window ending today.
 */
export function buildWeeklyReportMessage(userId: number): string {
  const today = todayLocal();
  const weekStart = addDays(today, -6).slice(0, 10);

  const lines: string[] = [`📊 Tu resumen semanal (${weekdayName(weekStart)} ${weekStart} al ${weekdayName(today)} ${today}):`];

  const routines = todosRepo.list(userId, { scope: 'routine' });
  lines.push('', '🔁 Rutinas:');
  if (routines.length === 0) {
    lines.push('(No tienes rutinas activas.)');
  } else {
    for (const r of routines) {
      const done = habitLogsRepo.countDoneInRange(r.id, weekStart, today);
      const streak = habitLogsRepo.currentStreak(r.id, today);
      const badge = done === 7 ? ' 🏆' : done >= 4 ? ' 💪' : done === 0 ? ' 😴' : '';
      lines.push(`- ${r.title}: ${done}/7 días cumplidos${badge} (racha actual: ${streak} día${streak === 1 ? '' : 's'})`);
    }
  }

  const oneOff = todosRepo.list(userId).filter((t) => t.scope !== 'routine');
  const completedThisWeek = oneOff.filter(
    (t) => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= weekStart && t.completed_at.slice(0, 10) <= today,
  );
  const stillPending = oneOff.filter((t) => t.status === 'pending');

  lines.push('', '✅ Tareas de una sola vez:');
  lines.push(`- Cumplidas esta semana: ${completedThisWeek.length}`);
  lines.push(`- Todavía pendientes: ${stillPending.length}`);
  if (stillPending.length > 0) {
    for (const t of stillPending.slice(0, 10)) lines.push(`  - #${t.id} ${t.title}`);
    if (stillPending.length > 10) lines.push(`  ...y ${stillPending.length - 10} más.`);
  }

  const totalConsidered = completedThisWeek.length + stillPending.length;
  if (totalConsidered > 0) {
    const rate = Math.round((completedThisWeek.length / totalConsidered) * 100);
    lines.push('', `📈 De lo que tenías entre manos, cumpliste el ${rate}%.`);
  }

  return lines.join('\n');
}

/**
 * Creates the recurring "weekly_report" reminder for a user if they don't already have one -
 * same idempotent bootstrap/grant_access/backfill pattern as ensureDailyAgendaReminder() (see
 * agenda.ts). Fires weekly on WEEKLY_REPORT_DAY at WEEKLY_REPORT_TIME; content is built fresh at
 * send time by buildWeeklyReportMessage() above.
 */
export function ensureWeeklyReportReminder(userId: number, targetJid: string): void {
  const already = remindersRepo.listAll(userId).some((r) => r.kind === 'weekly_report');
  if (already) return;

  const [h, m] = env.weeklyReportTime.split(':').map(Number);
  const hh = String(h ?? 19).padStart(2, '0');
  const mm = String(m ?? 0).padStart(2, '0');

  let candidate = todayLocal();
  for (let i = 0; i < 7; i++) {
    if (parseWall(candidate).getUTCDay() === env.weeklyReportDay) break;
    candidate = addDays(candidate, 1).slice(0, 10);
  }
  let runAt = `${candidate} ${hh}:${mm}:00`;
  if (parseWall(runAt) <= parseWall(nowLocal())) runAt = addDays(runAt, 7);

  remindersRepo.create(userId, {
    message: 'Resumen semanal', // unused at send time - buildWeeklyReportMessage() generates it fresh
    runAt,
    targetJid,
    categoryId: null,
    recurrenceFreq: 'weekly',
    recurrenceInterval: 1,
    kind: 'weekly_report',
  });
  console.log('[WEEKLY] Resumen semanal programado para el usuario #%d (día %d a las %s:%s).', userId, env.weeklyReportDay, hh, mm);
}
