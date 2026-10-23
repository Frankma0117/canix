/**
 * Date helpers for the portal. The server works in wall-clock 'YYYY-MM-DD HH:mm:ss' strings in the
 * bot's timezone (Colombia) - these helpers only ever manipulate those strings (UTC math on them,
 * never the browser's local timezone), so a person browsing from another country still sees the
 * same times the bot and the professional see.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const WEEKDAY_NAMES = WEEKDAYS;
export const WEEKDAY_SHORT = WEEKDAYS_SHORT;

function parse(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Today in the bot's timezone (America/Bogota). */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function nowWall(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export function addDaysISO(d: string, n: number): string {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}
export function weekday(d: string): number {
  return parse(d).getUTCDay();
}
/** Monday of the week containing d. */
export function startOfWeek(d: string): string {
  const wd = weekday(d);
  return addDaysISO(d, wd === 0 ? -6 : 1 - wd);
}
export function startOfMonth(d: string): string {
  return `${d.slice(0, 7)}-01`;
}
export function addMonthsISO(d: string, n: number): string {
  const dt = parse(startOfMonth(d));
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return fmt(dt);
}
export function formatDayLong(d: string): string {
  const dt = parse(d);
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} de ${MONTHS[dt.getUTCMonth()]}`;
}
export function formatMonth(d: string): string {
  const dt = parse(d);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
/** '2026-10-09 15:30:00' -> '3:30 p. m.' */
export function time12(at: string): string {
  const [h, m] = at.slice(11, 16).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
export function formatWhen(at: string): string {
  return `${formatDayLong(at.slice(0, 10))}, ${time12(at)}`;
}
export function minutesOfDay(at: string): number {
  const [h, m] = at.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}
