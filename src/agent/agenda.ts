import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { todayLocal, weekdayName, dateOnly, nowLocal } from '../util/datetime.js';
import { nightFarewellMessage } from '../util/motivational.js';
import { occursOn, scheduleOf } from './routine-schedule.js';
import { progressBar, timeChip } from '../util/wa-format.js';
import { env } from '../config/env.js';

interface AgendaItem {
  time: string; // 'HH:mm'
  label: string;
}

/**
 * Builds today's ordered agenda (routines + today's one-off reminders, sorted by time, plus
 * today's no-fixed-time todos at the end) for a user - only ever shown on demand (get_today_agenda
 * tool) or as system-prompt context, never pushed proactively (see the removed daily_agenda auto-
 * push, ReminderKind's comment in types/index.ts). Built fresh on every call so it's always
 * accurate: a routine already checked in today shows as done instead of being asked about again
 * (point behind why the bot used to nag after an early check-in), and a routine whose time already
 * passed without a check-in is flagged so the user can ask to move it to another slot the same day
 * (edit_routine).
 */
export function buildAgendaMessage(userId: number): string {
  const today = todayLocal();
  const now = nowLocal();
  const items: AgendaItem[] = [];

  const routines = todosRepo.list(userId, { scope: 'routine' });
  for (const r of routines) {
    if (!r.reminder_time || !occursOn(scheduleOf(r), today)) continue; // not one of its days
    const log = habitLogsRepo.getForDate(r.id, today);
    const runAt = `${today} ${r.reminder_time}:00`;
    const paused = remindersRepo.listByTodo(r.id).some((rem) => rem.paused_until && rem.paused_until > now);
    let note = '';
    if (paused) note = ' — ⏸️ pausada';
    else if (log?.done) note = ' — ✅ ya cumplida hoy';
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

  const lines: string[] = [];
  lines.push(`📋 Tu día de hoy (${today}, ${weekdayName(today)}):`);

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

/** How many of today's todos/routines are still pending right now - used by maybeNightFarewell()
 *  below to know whether a just-completed one was the LAST one. Mirrors buildAgendaMessage's own
 *  notion of "today's work" (today-scope todos + routines), minus the items already marked done. */
function remainingTodayCount(userId: number): number {
  const today = todayLocal();
  const todosToday = todosRepo.list(userId, { scope: 'today', status: 'pending' }).length;
  const routines = todosRepo.list(userId, { scope: 'routine' });
  const routinesPending = routines.filter((r) => occursOn(scheduleOf(r), today) && !habitLogsRepo.getForDate(r.id, today)?.done).length;
  return todosToday + routinesPending;
}

/**
 * Returns a "buenas noches" message when completing something (complete_todo/checkin_routine, see
 * those tools) just cleared the LAST pending todo/routine for today AND it's already late enough
 * (env.nightSummaryAfterHour, default 18h) - the user's own ask: mirror the automatic "buenos días"
 * on the morning agenda with a symmetric goodnight when the day's work is actually done, instead of
 * only ever greeting in the morning. Returns null otherwise (still tasks left, or too early in the
 * day to call it "night" even if everything happened to get done already) - callers should treat a
 * null as "say nothing extra", not an error.
 */
export function maybeNightFarewell(userId: number): string | null {
  const hour = Number(nowLocal().slice(11, 13));
  if (hour < env.nightSummaryAfterHour) return null;
  if (remainingTodayCount(userId) > 0) return null;
  return nightFarewellMessage();
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Longest list shown in full; beyond it the rest is summarized so the message stays readable. */
const AGENDA_MAX_ROWS = 8;

function agendaBlock(title: string, rows: { time: string; label: string }[], opts: { fromEnd?: boolean } = {}): string[] {
  if (rows.length === 0) return [];
  const shown = opts.fromEnd ? rows.slice(-AGENDA_MAX_ROWS) : rows.slice(0, AGENDA_MAX_ROWS);
  const lines = ['', `${title} · ${rows.length}`];
  if (rows.length > shown.length && opts.fromEnd) lines.push(`_… ${rows.length - shown.length} más antes_`);
  lines.push(...shown.map((r) => `${timeChip(r.time)} ${r.label}`));
  if (rows.length > shown.length && !opts.fromEnd) lines.push(`_… y ${rows.length - shown.length} más_`);
  return lines;
}

/**
 * Today as the person sees it on WhatsApp: a progress bar, then three clearly separate blocks -
 * what went by without being marked, what was marked (done, or answered "no"), and what's still
 * coming. Same data as buildAgendaMessage above (which stays as the plain version the model reads
 * as context). `unmarked` says how many are waiting, for whoever wants to offer rescheduling.
 */
export function agendaView(userId: number): { text: string; unmarked: number } {
  const today = todayLocal();
  const now = nowLocal();
  const nowTime = now.slice(11, 16);
  const unmarked: { time: string; label: string }[] = [];
  const upcoming: { time: string; label: string }[] = [];
  const marked: { time: string; label: string }[] = [];
  let doneCount = 0;
  let routinesDue = 0;

  for (const r of todosRepo.list(userId, { scope: 'routine' })) {
    if (!r.reminder_time || !occursOn(scheduleOf(r), today)) continue;
    const time = scheduleOf(r).time;
    const paused = remindersRepo.listByTodo(r.id).some((rem) => rem.paused_until && rem.paused_until > now);
    if (paused) continue;
    routinesDue++;
    const log = habitLogsRepo.getForDate(r.id, today);
    if (log?.done) {
      doneCount++;
      marked.push({ time, label: `${r.title} — hecha ✓` });
    } else if (log) marked.push({ time, label: `${r.title} — no se hizo` });
    else if (time <= nowTime) unmarked.push({ time, label: r.title });
    else upcoming.push({ time, label: r.title });
  }

  for (const rem of remindersRepo.listAll(userId, 'pending')) {
    if (rem.kind !== 'reminder' && rem.kind !== 'important_date' && rem.kind !== 'flexible') continue;
    if (dateOnly(rem.run_at) !== today) continue;
    upcoming.push({ time: rem.run_at.slice(11, 16), label: rem.message });
  }

  const byTime = (a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time);
  for (const list of [unmarked, upcoming, marked]) list.sort(byTime);
  const todosToday = todosRepo.list(userId, { scope: 'today', status: 'pending' });

  const d = new Date(`${today}T00:00:00Z`);
  const lines = [`📅 *Tu día* · ${weekdayName(today)} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`];
  if (routinesDue > 0) lines.push(`${progressBar(doneCount, routinesDue)}  ${doneCount} de ${routinesDue} rutinas hechas`);

  if (unmarked.length + upcoming.length + marked.length + todosToday.length === 0) {
    lines.push('', 'No tienes nada agendado para hoy 🎉');
    return { text: lines.join('\n'), unmarked: 0 };
  }

  lines.push(...agendaBlock('🔴 *Sin marcar*', unmarked, { fromEnd: true }));
  lines.push(...agendaBlock('🟢 *Marcadas*', marked, { fromEnd: true }));
  lines.push(...agendaBlock('🔵 *Lo que viene*', upcoming));
  if (todosToday.length > 0) {
    lines.push('', `📌 *Pendientes sin hora* · ${todosToday.length}`, ...todosToday.slice(0, AGENDA_MAX_ROWS).map((t) => `- ${t.title}`));
    if (todosToday.length > AGENDA_MAX_ROWS) lines.push(`_… y ${todosToday.length - AGENDA_MAX_ROWS} más_`);
  }
  return { text: lines.join('\n'), unmarked: unmarked.length };
}

export function renderAgenda(userId: number): string {
  return agendaView(userId).text;
}

const AGENDA_BLOCKERS = /\b(manana|ayer|semana|mes|lunes|martes|miercoles|jueves|viernes|sabado|domingo|crea|agrega|pon|cambia|borra|elimina|edita|marca)\b|\d/;
const AGENDA_ASKS = [
  /^(mi )?(agenda|dia|pendientes)( de hoy| del dia)?$/,
  /\b(que|cual|cuales) (tengo|me queda|me falta|hay|es|son)\b.*\b(hoy|agendado|agendada|programado|pendiente|pendientes|dia|rutina|rutinas)\b/,
  /\b(que|cual|cuales) (es|son) (mi|mis) (rutina|rutinas|agenda|pendientes)\b/,
  /\bcomo (va|voy)\b.*\b(dia|hoy)\b/,
  /\bque (me queda|me falta|tengo)( por hacer)?$/,
];

/**
 * True for a plain "what do I have today?" ("qué tengo agendado", "cuál es mi rutina del día",
 * "cómo va mi día") - answered straight with the designed agenda instead of going through the
 * model, which tends to re-write the list its own way. Anything with a date, a number or an
 * action in it is left to the model.
 */
export function asksForTodayAgenda(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 60 || AGENDA_BLOCKERS.test(t)) return false;
  return AGENDA_ASKS.some((re) => re.test(t));
}
