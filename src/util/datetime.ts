import { env } from '../config/env.js';

/**
 * Date/time utilities that work on "wall-clock" time in
 * 'YYYY-MM-DD HH:mm:ss' format, with no timezone conversions.
 * Arithmetic is done by treating the string as UTC (a reversible trick).
 */

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Converts a date/time string to a "UTC-wall" Date to operate on. */
export function parseWall(s: string): Date {
  const clean = s.replace('T', ' ').trim();
  const [datePart, timePart = '00:00:00'] = clean.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h = 0, mi = 0, se = 0] = timePart.split(':').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, h, mi, se));
}

/** Formats a "UTC-wall" Date back to 'YYYY-MM-DD HH:mm:ss'. */
export function fmtWall(dt: Date): string {
  return (
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ` +
    `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`
  );
}

/** Adds minutes to a local date/time string and returns another string. */
export function addMinutes(s: string, minutes: number): string {
  const dt = parseWall(s);
  dt.setUTCMinutes(dt.getUTCMinutes() + minutes);
  return fmtWall(dt);
}

/** Adds N days (can be negative) to a local date/time string. */
export function addDays(s: string, days: number): string {
  return addMinutes(s, days * 24 * 60);
}

/** Adds seconds to a local date/time string - used by short-cycle interval reminders (see task-scheduler.ts). */
export function addSeconds(s: string, seconds: number): string {
  const dt = parseWall(s);
  dt.setUTCSeconds(dt.getUTCSeconds() + seconds);
  return fmtWall(dt);
}

/** Picks a random 'HH:mm:ss' time within [windowStart, windowEnd] (both 'HH:mm') on the given date. */
export function randomTimeOnDate(dateOnly: string, windowStart: string, windowEnd: string): string {
  const [sh, sm] = windowStart.split(':').map(Number);
  const [eh, em] = windowEnd.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = Math.max((eh ?? 0) * 60 + (em ?? 0), startMin); // guards against an inverted window
  const pick = startMin + Math.floor(Math.random() * (endMin - startMin + 1));
  return `${dateOnly} ${pad(Math.floor(pick / 60))}:${pad(pick % 60)}:00`;
}

/** Adds N whole months (keeping day-of-month; clamps to shorter months). */
export function addMonths(s: string, months: number): string {
  const dt = parseWall(s);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, lastDay));
  return fmtWall(dt);
}

/** Normalizes any tolerable input to 'YYYY-MM-DD HH:mm:ss'. */
export function normalizeDate(s: string): string {
  return fmtWall(parseWall(s));
}

/** Returns just the date part 'YYYY-MM-DD' of a wall string. */
export function dateOnly(s: string): string {
  return normalizeDate(s).slice(0, 10);
}

/**
 * Current time (per TIMEZONE) as 'YYYY-MM-DD HH:mm:ss'.
 * Uses Intl to get the wall-clock time in that timezone.
 */
export function nowLocal(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  // en-CA gives a YYYY-MM-DD date format.
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}

/** Today's date only, 'YYYY-MM-DD' (per TIMEZONE). */
export function todayLocal(): string {
  return nowLocal().slice(0, 10);
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Human-readable description of the current moment for the LLM prompt. */
export function currentTimeContext(): string {
  const now = nowLocal();
  const weekday = WEEKDAYS[parseWall(now).getUTCDay()];
  return `Fecha y hora actual (${env.timezone}): ${now} (${weekday}).`;
}

/** Weekday name (Spanish) for a given 'YYYY-MM-DD[...]' string. */
export function weekdayName(s: string): string {
  return WEEKDAYS[parseWall(s).getUTCDay()];
}
