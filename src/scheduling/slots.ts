import { addDays, addMinutes, nowLocal, todayLocal, parseWall, time12h, weekdayName } from '../util/datetime.js';
import { schedRepo, type Professional } from './repo.js';

export interface Slot {
  start_at: string;
  end_at: string;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-10-09 15:00:00' -> 'viernes 9 de octubre, 3:00 p. m.' */
export function formatWhen(at: string): string {
  const d = parseWall(at);
  return `${weekdayName(at)} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}, ${time12h(at)}`;
}

/** '2026-10-09' -> 'viernes 9 de octubre' */
export function formatDay(date: string): string {
  const d = parseWall(date);
  return `${weekdayName(date)} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

const MAX_SLOTS = 300;

/**
 * Free slots of a professional between two dates (inclusive, 'YYYY-MM-DD'), built from their weekly
 * availability minus: anything sooner than their minimum notice, beyond max_days_ahead, blocked
 * time off, and active (pending/confirmed) appointments - each padded by buffer_minutes so back-to-
 * back sessions keep the professional's configured gap. Pending requests block their slot too, so
 * two clients can never request the same time.
 */
export function availableSlots(prof: Professional, fromDate: string, toDate: string): Slot[] {
  const today = todayLocal();
  const lastAllowed = addDays(today, prof.max_days_ahead).slice(0, 10);
  const from = fromDate < today ? today : fromDate;
  const to = toDate > lastAllowed ? lastAllowed : toDate;
  if (from > to) return [];

  const earliest = addMinutes(nowLocal(), prof.min_notice_minutes);
  const rules = schedRepo.availability(prof.user_id);
  if (!rules.length) return [];

  const rangeStart = `${from} 00:00:00`;
  const rangeEnd = `${addDays(to, 1).slice(0, 10)} 00:00:00`;
  const busy = [
    ...schedRepo.activeOverlapping(prof.user_id, rangeStart, rangeEnd).map((a) => ({
      start: addMinutes(a.start_at, -prof.buffer_minutes),
      end: addMinutes(a.end_at, prof.buffer_minutes),
    })),
    ...schedRepo.timeOff(prof.user_id, rangeStart, rangeEnd).map((t) => ({ start: t.start_at, end: t.end_at })),
  ];

  const slots: Slot[] = [];
  for (let day = from; day <= to; day = addDays(day, 1).slice(0, 10)) {
    const weekday = parseWall(day).getUTCDay();
    for (const rule of rules.filter((r) => r.weekday === weekday)) {
      const windowEnd = `${day} ${rule.end_time}:00`;
      let start = `${day} ${rule.start_time}:00`;
      while (addMinutes(start, prof.slot_minutes) <= windowEnd) {
        const end = addMinutes(start, prof.slot_minutes);
        if (start >= earliest && !busy.some((b) => b.start < end && b.end > start)) {
          slots.push({ start_at: start, end_at: end });
          if (slots.length >= MAX_SLOTS) return slots;
        }
        start = addMinutes(start, prof.slot_minutes + prof.buffer_minutes);
      }
    }
  }
  return slots.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
}
