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

const DATETIME_RE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?)?)?$/i;

/** "+20m", "+2 h", "+ 90 min", "+1 hora" -> minutes from now; null if it isn't that form. */
function parseRelativeMinutes(raw: string): number | null {
  const m = /^\+\s*(\d{1,4})\s*(m|min|mins|minutos?|h|hr|hrs|horas?)$/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase().startsWith('h') ? n * 60 : n;
}

/**
 * Strict version of normalizeDate for anything coming from the model or a user: returns null
 * instead of a garbage value. normalizeDate("mañana") silently produced "NaN-NaN-NaN NaN:NaN:NaN"
 * (which then compares as "not in the past" and got SAVED - a reminder that can never fire), and
 * "2026-02-30" silently rolled over to March 2nd. Both are rejected here.
 */
export function parseStrictDateTime(raw: string): string | null {
  const m = DATETIME_RE.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', se = '0', ampm] = m;
  const nums = [y, mo, d, h, mi, se].map(Number);
  // The model sometimes copies the person's "3:00 pm" literally - accept it instead of failing.
  if (ampm) {
    if (nums[3] < 1 || nums[3] > 12) return null;
    nums[3] = (nums[3] % 12) + (ampm.toLowerCase() === 'p' ? 12 : 0);
  }
  if (nums[1] < 1 || nums[1] > 12 || nums[3] > 23 || nums[4] > 59 || nums[5] > 59) return null;
  const dt = new Date(Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5]));
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== nums[2]) return null; // e.g. Feb 30
  return fmtWall(dt);
}

/**
 * One shared gate for every "schedule something at X" tool: X must be a valid date-time AND in
 * the future. The error text tells the model the current time and forbids it from picking an
 * alternative on its own - it must ask the person (see BASE_PROMPT's "HORAS QUE YA PASARON").
 */
export function validateFutureDateTime(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const now = nowLocal();
  // "en 20 minutos" -> "+20 min": computed here, exactly, instead of trusting the model's arithmetic.
  const relative = parseRelativeMinutes(String(raw ?? ''));
  if (relative !== null) {
    if (relative < 1) return { ok: false, error: 'El tiempo relativo debe ser de al menos 1 minuto.' };
    return { ok: true, value: addMinutes(now.slice(0, 16) + ':00', relative) };
  }
  // A bare date would silently mean midnight - never what someone asking for a reminder meant.
  const value = /[ T]\d{1,2}:\d{2}/.test(String(raw ?? '')) ? parseStrictDateTime(raw) : null;
  if (!value) {
    return {
      ok: false,
      error: `"${raw}" no es una fecha/hora válida (formato 'YYYY-MM-DD HH:mm'). Ahora son ${now.slice(0, 16)} (${time12h(now)}). Recalcúlala; si no estás seguro de qué fecha/hora quiso decir, pregúntale.`,
    };
  }
  if (parseWall(value) <= parseWall(now)) {
    return {
      ok: false,
      error:
        `Esa hora (${value.slice(0, 16)}) ya pasó: ahora son ${now.slice(0, 16)} (${time12h(now)}). ` +
        'NO la cambies por tu cuenta - dile que esa hora ya pasó y pregúntale qué prefiere (mañana a esa ' +
        'hora, otra hora hoy, o en X minutos). No agendes nada hasta que responda.',
    };
  }
  return { ok: true, value };
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
  return `Fecha y hora actual (${env.timezone}): ${now} (${weekday}, ${time12h(now)}).`;
}

/**
 * The next 14 days spelled out for the model ("mañana jueves 2026-10-09, ..."). Models are bad at
 * weekday -> date arithmetic ("el jueves", "el próximo lunes") - with this table they read the
 * date instead of computing it, which was a recurring source of appointments on the wrong day.
 */
export function upcomingDaysContext(withRelativeHint = true): string {
  const today = todayLocal();
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i).slice(0, 10);
    const prefix = i === 0 ? 'hoy ' : i === 1 ? 'mañana ' : i === 2 ? 'pasado mañana ' : '';
    days.push(`${prefix}${weekdayName(date)} ${date}`);
  }
  return (
    `Calendario (úsalo para convertir "el jueves", "el próximo lunes", etc. - NO calcules la fecha de memoria): ${days.join('; ')}.\n` +
    'Para "en X minutos/horas" puedes pasar la hora como "+X min" o "+X h" (el sistema calcula la hora exacta).'
  );
}

/** 'YYYY-MM-DD HH:mm[:ss]' -> '10:43 p. m.' - how people actually say/write times in chat, given
 *  to the model next to the 24h value so "a las 10" vs the current hour is unambiguous to it. */
export function time12h(s: string): string {
  const d = parseWall(s);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getUTCMinutes())} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Weekday name (Spanish) for a given 'YYYY-MM-DD[...]' string. */
export function weekdayName(s: string): string {
  return WEEKDAYS[parseWall(s).getUTCDay()];
}
