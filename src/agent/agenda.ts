import { withIcon } from '../util/icons.js';
import { stripKnownPrefix } from '../util/motivational.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { todayLocal, weekdayName, dateOnly, nowLocal, addDays, addMonths, parseWall } from '../util/datetime.js';
import { dayLabel } from './views.js';
import type { Reminder } from '../types/index.js';
import { nightFarewellMessage } from '../util/motivational.js';
import { occursOn, scheduleOf } from './routine-schedule.js';
import { progressBar, shortTime, timeChip } from '../util/wa-format.js';
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

/** Longest block shown in full; beyond it the rest is counted so the message stays readable. */
const AGENDA_MAX_ROWS = 15;

type Row = { time: string; label: string };

function agendaBlock(title: string, rows: Row[], opts: { fromEnd?: boolean } = {}): string[] {
  if (rows.length === 0) return [];
  const shown = opts.fromEnd ? rows.slice(-AGENDA_MAX_ROWS) : rows.slice(0, AGENDA_MAX_ROWS);
  const lines = ['', `${title} · ${rows.length}`];
  if (rows.length > shown.length && opts.fromEnd) lines.push(`_… ${rows.length - shown.length} más antes_`);
  lines.push(...shown.map((r) => `${timeChip(r.time)} ${r.label}`));
  if (rows.length > shown.length && !opts.fromEnd) lines.push(`_… y ${rows.length - shown.length} más_`);
  return lines;
}

/**
 * "Tomar agua" at 6, 8, 10... is one thing said eight times: shown once, at its first hour, with
 * how many times and until when - so the day's real reminders aren't buried under it.
 */
function collapseRepeats(rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(row.label, [...(groups.get(row.label) ?? []), row]);
  return [...groups.values()]
    .map((same) => (same.length === 1 ? same[0] : { time: same[0].time, label: `${same[0].label} · ${same.length} veces, hasta las ${shortTime(same[same.length - 1].time)}` }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** The time ('HH:mm') at which a pending reminder falls on `date`, following its recurrence - null if it doesn't. */
function reminderTimeOn(rem: Reminder, date: string): string | null {
  let at = rem.run_at;
  if (dateOnly(at) === date) return at.slice(11, 16);
  if (dateOnly(at) > date || rem.recurrence_freq === 'none' || rem.kind === 'interval') return null;
  const step = Math.max(1, rem.recurrence_interval || 1);
  for (let i = 0; i < 800 && dateOnly(at) < date; i++) {
    at =
      rem.recurrence_freq === 'daily'
        ? addDays(at, step)
        : rem.recurrence_freq === 'weekly'
          ? addDays(at, 7 * step)
          : addMonths(at, rem.recurrence_freq === 'yearly' ? 12 * step : step);
  }
  return dateOnly(at) === date ? at.slice(11, 16) : null;
}

/**
 * One day as the person sees it on WhatsApp - today by default, or any other date with the same
 * look. Three clearly separate blocks: what went by without being marked, what was marked (done,
 * or answered "no"), and what's coming / scheduled. Same data as buildAgendaMessage above (which
 * stays as the plain version the model reads as context). `unmarked` says how many are waiting,
 * for whoever wants to offer rescheduling.
 */
export function agendaView(userId: number, date: string = todayLocal()): { text: string; unmarked: number } {
  const today = todayLocal();
  const now = nowLocal();
  const isToday = date === today;
  const isPast = date < today;
  const nowTime = now.slice(11, 16);
  const unmarked: Row[] = [];
  const upcoming: Row[] = [];
  const marked: Row[] = [];
  // Reminders are their own thing (a one-off notice, nothing to mark as a habit) - listed apart.
  const reminders: Row[] = [];
  let doneCount = 0;
  let routinesDue = 0;

  for (const r of todosRepo.list(userId, { scope: 'routine' })) {
    if (!r.reminder_time || !occursOn(scheduleOf(r), date)) continue;
    const time = scheduleOf(r).time;
    const pauseFrom = isToday ? now : `${date} ${time}:00`;
    if (!isPast && remindersRepo.listByTodo(r.id).some((rem) => rem.paused_until && rem.paused_until > pauseFrom)) continue;
    routinesDue++;
    const log = habitLogsRepo.getForDate(r.id, date);
    if (log?.done) {
      doneCount++;
      marked.push({ time, label: `${withIcon(r.title)} — hecha ✓` });
    } else if (log) marked.push({ time, label: `${withIcon(r.title)} — no se hizo` });
    else if (isPast || (isToday && time <= nowTime)) unmarked.push({ time, label: withIcon(r.title) });
    else upcoming.push({ time, label: withIcon(r.title) });
  }

  if (!isPast) {
    for (const rem of remindersRepo.listAll(userId, 'pending')) {
      if (rem.kind !== 'reminder' && rem.kind !== 'important_date' && rem.kind !== 'flexible') continue;
      const time = reminderTimeOn(rem, date);
      if (time) reminders.push({ time, label: withIcon(stripKnownPrefix(rem.message), '🔔') });
    }
  }

  const byTime = (a: Row, b: Row) => a.time.localeCompare(b.time);
  for (const list of [unmarked, upcoming, marked, reminders]) list.sort(byTime);
  const todos = isToday
    ? todosRepo.list(userId, { scope: 'today', status: 'pending' })
    : todosRepo.list(userId, { status: 'pending' }).filter((t) => t.scope !== 'routine' && t.due_date === date);

  const lines = [isToday ? `📅 *Tu día* · ${dayLabel(date).replace(/^Hoy · /, '')}` : `📅 *${dayLabel(date)}*`];
  if (routinesDue > 0 && !(date > today)) lines.push(`${progressBar(doneCount, routinesDue)}  ${doneCount} de ${routinesDue} rutinas hechas`);

  if (unmarked.length + upcoming.length + marked.length + reminders.length + todos.length === 0) {
    lines.push('', isPast ? 'No hay nada registrado ese día.' : 'No tienes nada agendado 🎉');
    return { text: lines.join('\n'), unmarked: 0 };
  }

  if (routinesDue > 0) {
    lines.push('', '🔁 *RUTINAS*');
    const blocks = [
      ...agendaBlock('🔴 *Sin marcar*', unmarked, { fromEnd: true }),
      ...agendaBlock('🟢 *Marcadas*', marked, { fromEnd: true }),
      ...agendaBlock(isToday ? '🔵 *Lo que viene*' : '🔵 *Programadas*', upcoming),
    ];
    lines.push(...blocks.slice(1)); // the section title already gives the gap
  }
  lines.push(...agendaBlock('⏰ *RECORDATORIOS*', collapseRepeats(reminders)));
  if (todos.length > 0) {
    lines.push('', `📌 *Pendientes sin hora* · ${todos.length}`, ...todos.slice(0, AGENDA_MAX_ROWS).map((t) => `⬜ ${withIcon(t.title, '')}`.replace('⬜  ', '⬜ ')));
    if (todos.length > AGENDA_MAX_ROWS) lines.push(`_… y ${todos.length - AGENDA_MAX_ROWS} más_`);
  }
  return { text: lines.join('\n'), unmarked: isToday ? unmarked.length : 0 };
}

export function renderAgenda(userId: number, date?: string): string {
  return agendaView(userId, date).text;
}

const WEEKDAY_WORDS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DAY = `(?:hoy|pasado manana|manana|ayer|${WEEKDAY_WORDS.join('|')})`;
const AGENDA_BLOCKERS = /\b(semana|mes|ano|crea|agrega|pon|ponme|cambia|borra|elimina|edita|marca|mueve|reprograma|recuerdame|agenda una|agendame)\b|\d/;
const AGENDA_ASKS = [
  new RegExp(`^(?:mi |la )?(?:agenda|dia|pendientes|rutina|rutinas)(?: de| del| para)?(?: el)?(?: dia)?(?: de)?(?: ${DAY})?$`),
  new RegExp(`\\b(?:que|cual|cuales) (?:tengo|tenia|tuve|me queda|me falta|hay|es|son)\\b.*\\b(?:${DAY}|agendado|agendada|programado|pendiente|pendientes|dia|rutina|rutinas)\\b`),
  /\bcomo (?:va|voy|me fue)\b.*\b(?:dia|hoy|ayer)\b/,
  /\bque (?:me queda|me falta|tengo)(?: por hacer)?$/,
];

/**
 * The day a plain "what do I have ...?" asks about ("qué tengo agendado", "cuál es mi rutina del
 * día", "qué tengo mañana", "qué hay el viernes", "cómo me fue ayer"), as 'YYYY-MM-DD' - or null
 * when the message isn't that. Those get the designed agenda straight away instead of going
 * through the model, which tends to re-write the list its own way. Anything with a number, a
 * week/month range or an action in it is left to the model.
 */
export function agendaDateAsked(text: string): string | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 60 || AGENDA_BLOCKERS.test(t)) return null;
  if (!AGENDA_ASKS.some((re) => re.test(t))) return null;

  const today = todayLocal();
  if (/\bpasado manana\b/.test(t)) return addDays(today, 2).slice(0, 10);
  if (/\bmanana\b/.test(t) && !/\b(esta|la|por la|en la) manana\b/.test(t)) return addDays(today, 1).slice(0, 10);
  if (/\bayer\b/.test(t)) return addDays(today, -1).slice(0, 10);
  const weekday = WEEKDAY_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (weekday >= 0 && !/\bhoy\b/.test(t)) {
    // "el viernes" = the next one coming (a week from now if today is that day).
    const ahead = (weekday - parseWall(today).getUTCDay() + 7) % 7 || 7;
    return addDays(today, ahead).slice(0, 10);
  }
  return today;
}
