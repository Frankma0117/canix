/** Time zone helpers (no libraries): schedules are written in the project's local time. */
export const DEFAULT_TZ = 'America/Bogota';

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** Offset of the zone from UTC at that instant, in ms. */
const offsetMs = (d: Date, tz: string) => {
  const p = parts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000;
};

/** «2026-11-15» + «08:00» in a zone → the UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(new Date(guess), tz);
  const again = guess - offsetMs(new Date(t), tz); // around a DST change the first guess can be off by the shift
  if (again !== t) t = again;
  return new Date(t);
}

/** The calendar day (in the zone) of an instant, and its weekday (0 = Sunday). */
export function localDay(d: Date, tz: string): { date: string; weekday: number } {
  const p = parts(d, tz);
  return { date: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, weekday: p.wd };
}

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
