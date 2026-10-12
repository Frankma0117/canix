import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { addDays, dateOnly, parseWall, nowLocal } from '../util/datetime.js';
import type { Todo } from '../types/index.js';

/**
 * When a routine happens: every day, on certain weekdays, every N weeks ("cada 15 días" = every 2
 * weeks), or monthly on a day of the month. One place answers "does it happen on this date?" and
 * "when is the next one?" for the scheduler, the agenda, the reports and the web portal, so they
 * can never disagree.
 */
export type RoutineFreq = 'daily' | 'weekly' | 'monthly';

export interface RoutineSchedule {
  freq: RoutineFreq;
  /** Every how many days/weeks/months. */
  interval: number;
  /** 0 = domingo ... 6 = sábado. Only used for 'weekly'. */
  weekdays: number[];
  /** 1-31, clamped to the month's last day. Only used for 'monthly'. */
  monthDay: number | null;
  /** 'YYYY-MM-DD' the pattern is anchored to: nothing happens before it, and with interval > 1 it
   *  decides which days/weeks/months are the "on" ones. */
  startDate: string | null;
  /** 'HH:mm' */
  time: string;
}

export const WEEKDAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const DAY_MS = 86_400_000;

function padTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String(h ?? 0).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
}

export function parseWeekdays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const days = raw
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Accepts numbers or Spanish day names ("lunes", "mié", "sabado") from the model or the portal. */
export function normalizeWeekdays(input: unknown): number[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\s]+/) : [];
  const out = new Set<number>();
  for (const item of list) {
    if (typeof item === 'number' || /^\d$/.test(String(item).trim())) {
      const n = Number(item);
      if (n >= 0 && n <= 6) out.add(n);
      else if (n === 7) out.add(0);
      continue;
    }
    const key = String(item)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .slice(0, 3);
    const idx = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'].indexOf(key);
    if (idx >= 0) out.add(idx);
  }
  return [...out].sort((a, b) => a - b);
}

export function scheduleOf(todo: Todo): RoutineSchedule {
  const freq: RoutineFreq = todo.recurrence_freq === 'weekly' ? 'weekly' : todo.recurrence_freq === 'monthly' ? 'monthly' : 'daily';
  const anchor = todo.start_date ?? todo.created_at.slice(0, 10);
  let weekdays = parseWeekdays(todo.weekdays);
  if (freq === 'weekly' && weekdays.length === 0) weekdays = [parseWall(anchor).getUTCDay()];
  return {
    freq,
    interval: Math.max(1, todo.recurrence_interval || 1),
    weekdays,
    monthDay: freq === 'monthly' ? (todo.month_day ?? parseWall(anchor).getUTCDate()) : null,
    startDate: todo.start_date,
    time: padTime(todo.reminder_time ?? '08:00'),
  };
}

function mondayOf(date: string): number {
  const d = parseWall(date);
  const wd = d.getUTCDay();
  return d.getTime() - (wd === 0 ? 6 : wd - 1) * DAY_MS;
}

export function occursOn(s: RoutineSchedule, date: string): boolean {
  if (s.startDate && date < s.startDate) return false;
  const d = parseWall(date);
  const anchor = s.startDate ? parseWall(s.startDate) : null;

  if (s.freq === 'daily') {
    if (s.interval <= 1 || !anchor) return true;
    return Math.round((d.getTime() - anchor.getTime()) / DAY_MS) % s.interval === 0;
  }

  if (s.freq === 'weekly') {
    if (!s.weekdays.includes(d.getUTCDay())) return false;
    if (s.interval <= 1 || !s.startDate) return true;
    return Math.round((mondayOf(date) - mondayOf(s.startDate)) / (7 * DAY_MS)) % s.interval === 0;
  }

  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (d.getUTCDate() !== Math.min(s.monthDay ?? 1, lastDay)) return false;
  if (s.interval <= 1 || !anchor) return true;
  const months = (d.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (d.getUTCMonth() - anchor.getUTCMonth());
  return months % s.interval === 0;
}

/** First occurrence strictly after `afterWall` ('YYYY-MM-DD HH:mm:ss'), or null if none is found. */
export function nextOccurrence(s: RoutineSchedule, afterWall: string): string | null {
  let date = dateOnly(afterWall);
  if (s.startDate && s.startDate > date) date = s.startDate;
  const limit = Math.min(4000, 400 * s.interval);
  for (let i = 0; i < limit; i++) {
    const candidate = `${date} ${s.time}:00`;
    if (candidate > afterWall && occursOn(s, date)) return candidate;
    date = addDays(date, 1).slice(0, 10);
  }
  return null;
}

/**
 * The date a new (or re-scheduled) routine gets anchored to: its first real occurrence from now,
 * or from `requestedStart` if that's later. Anchoring there means "cada 15 días los lunes" created
 * on a Wednesday starts NEXT Monday, not two weeks after a Monday that already passed.
 */
export function anchorDate(s: RoutineSchedule, requestedStart?: string | null): string {
  const now = nowLocal();
  const from = requestedStart && requestedStart > now.slice(0, 10) ? requestedStart : null;
  const first = nextOccurrence({ ...s, interval: 1, startDate: from }, now);
  return first ? first.slice(0, 10) : now.slice(0, 10);
}

function joinDays(days: number[]): string {
  const names = days.map((d) => WEEKDAY_LABELS[d]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** "todos los días", "lunes, miércoles y viernes", "cada 15 días (lunes)", "cada mes, el día 15". */
export function describeSchedule(s: RoutineSchedule): string {
  if (s.freq === 'daily') return s.interval <= 1 ? 'todos los días' : `cada ${s.interval} días`;
  if (s.freq === 'weekly') {
    const days = s.weekdays.length === 7 ? 'todos los días' : joinDays(s.weekdays);
    if (s.interval <= 1) return s.weekdays.length === 7 ? days : `cada ${days}`;
    return `${s.interval === 2 ? 'cada 15 días' : `cada ${s.interval} semanas`} (${days})`;
  }
  const every = s.interval <= 1 ? 'cada mes' : `cada ${s.interval} meses`;
  return `${every}, el día ${s.monthDay}`;
}

/** How many times the routine was due within [from, to] (both 'YYYY-MM-DD', inclusive). */
export function countOccurrences(s: RoutineSchedule, from: string, to: string): number {
  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1).slice(0, 10)) {
    if (occursOn(s, date)) count++;
  }
  return count;
}

/**
 * Consecutive due occurrences marked done, counting back from today. Days the routine isn't due
 * don't break it (a Monday-only routine keeps its streak through the week), and today not being
 * answered yet doesn't either.
 */
export function routineStreak(todo: Todo, today: string): number {
  const s = scheduleOf(todo);
  const done = new Set(habitLogsRepo.doneDates(todo.id));
  if (done.size === 0) return 0;
  // Before the current anchor (the routine was re-scheduled at some point) only the day pattern is
  // known, so that's what decides which older days counted.
  const loose: RoutineSchedule = { ...s, startDate: null, interval: 1 };
  const floor = todo.created_at.slice(0, 10);
  let streak = 0;
  let date = today;
  for (let i = 0; i < 1500 && date >= floor; i++) {
    if (occursOn(s.startDate && date < s.startDate ? loose : s, date)) {
      if (done.has(date)) streak++;
      else if (date !== today) break;
    }
    date = addDays(date, -1).slice(0, 10);
  }
  return streak;
}

/**
 * This week's progress (Monday to Sunday): how many times the routine is due in the whole week and
 * how many of those are already marked done - the "3 de 4 esta semana" next to the streak.
 */
export function weekProgress(todo: Todo, today: string): { done: number; due: number } {
  const monday = new Date(mondayOf(today)).toISOString().slice(0, 10);
  const sunday = addDays(monday, 6).slice(0, 10);
  const s = scheduleOf(todo);
  const done = new Set(habitLogsRepo.doneDates(todo.id));
  let due = 0;
  let hit = 0;
  for (let date = monday; date <= sunday; date = addDays(date, 1).slice(0, 10)) {
    if (!occursOn(s, date)) continue;
    due++;
    if (done.has(date)) hit++;
  }
  return { done: hit, due };
}
