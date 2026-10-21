import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { todayLocal, nowLocal, addDays, parseWall, weekdayName } from '../util/datetime.js';
import { countOccurrences, routineStreak, scheduleOf } from './routine-schedule.js';
import { env } from '../config/env.js';
import { progressBar } from '../util/wa-format.js';
import { rewardsReportLines } from './rewards-progress.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Longest routine list shown in full - beyond it the rest is summarized. */
const REPORT_MAX_ROWS = 12;

/**
 * Builds the weekly report (routines vs one-time tasks, segmented as asked) for a user - the
 * "how many of the week's pending stuff did I actually finish" counterpart to the daily agenda
 * (see agenda.ts's buildAgendaMessage, same "built fresh at send time" pattern). Covers the 7-day
 * window ending today.
 */
export function buildWeeklyReportMessage(userId: number): string {
  const today = todayLocal();
  const weekStart = addDays(today, -6).slice(0, 10);
  const day = (d: string) => `${Number(d.slice(8, 10))} de ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

  // Out of the times each routine was actually due this week (a Monday-only one is 1, not 7).
  const rows = todosRepo
    .list(userId, { scope: 'routine' })
    .map((r) => {
      const due = countOccurrences(scheduleOf(r), weekStart, today);
      const done = Math.min(habitLogsRepo.countDoneInRange(r.id, weekStart, today), due);
      return { title: r.title, due, done, streak: routineStreak(r, today) };
    })
    .filter((r) => r.due > 0)
    .sort((a, b) => b.done / b.due - a.done / a.due || b.streak - a.streak || a.title.localeCompare(b.title));
  const totalDue = rows.reduce((n, r) => n + r.due, 0);
  const totalDone = rows.reduce((n, r) => n + r.done, 0);

  const lines: string[] = [`📊 *Tu semana* · ${day(weekStart)} al ${day(today)}`];
  if (totalDue > 0) lines.push(`${progressBar(totalDone, totalDue)}  ${totalDone} de ${totalDue} · ${Math.round((totalDone / totalDue) * 100)}%`);

  lines.push('', `🔁 *Rutinas* · ${rows.length}`);
  if (rows.length === 0) lines.push('No te tocaba ninguna esta semana.');
  for (const r of rows.slice(0, REPORT_MAX_ROWS)) {
    const badge = r.done === r.due ? '🏆' : r.done * 2 >= r.due ? '💪' : r.done === 0 ? '😴' : '▫️';
    lines.push(`${badge} \`${r.done}/${r.due}\` ${r.title}${r.streak > 1 ? ` · 🔥 ${r.streak}` : ''}`);
  }
  if (rows.length > REPORT_MAX_ROWS) lines.push(`_… y ${rows.length - REPORT_MAX_ROWS} más_`);

  const oneOff = todosRepo.list(userId).filter((t) => t.scope !== 'routine');
  const completedThisWeek = oneOff.filter(
    (t) => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= weekStart && t.completed_at.slice(0, 10) <= today,
  );
  const stillPending = oneOff.filter((t) => t.status === 'pending');
  if (completedThisWeek.length + stillPending.length > 0) {
    lines.push('', `✅ *Tareas* · ${completedThisWeek.length} cumplidas, ${stillPending.length} pendientes`);
    for (const t of stillPending.slice(0, 6)) lines.push(`- ${t.title}`);
    if (stillPending.length > 6) lines.push(`_… y ${stillPending.length - 6} más_`);
  }

  lines.push(...rewardsReportLines(userId, weekStart, today));

  return lines.join('\n');
}

/**
 * Creates the recurring "weekly_report" reminder for a user if they don't already have one -
 * idempotent bootstrap/grant_access/backfill pattern (called once per user, no-op if it already
 * exists). Fires weekly on WEEKLY_REPORT_DAY at WEEKLY_REPORT_TIME; content is built fresh at
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
