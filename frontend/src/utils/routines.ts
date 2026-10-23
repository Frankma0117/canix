import type { Routine, RoutineFreq, WorkoutKind } from '../types/index.ts';
import { WEEKDAY_NAMES } from './dates.ts';

/** Monday first - how a week is read here. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** '08:05' -> ['8:05', 'a. m.'] */
export function clock(time: string): [string, string] {
  const [h, m] = time.split(':').map(Number);
  return [`${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`, h < 12 ? 'a. m.' : 'p. m.'];
}

export const clockText = (time: string) => clock(time).join(' ');

export function wallMs(at: string): number {
  const [d, t = '00:00:00'] = at.split(' ');
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi, s = 0] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, day, h, mi, s);
}

/** "2 h 10 min después del aviso" - empty when it was answered right away or no notice went out. */
export function delayText(sentAt: string | null, answeredAt: string): string {
  if (!sentAt) return '';
  const minutes = Math.round((wallMs(answeredAt) - wallMs(sentAt)) / 60_000);
  if (minutes < 10) return 'al momento del aviso';
  if (minutes < 60) return `${minutes} min después del aviso`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min después del aviso`;
  const days = Math.floor(minutes / 1440);
  return `${days} día${days === 1 ? '' : 's'} después del aviso`;
}

// ---------------------------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------------------------
export type Mode = 'daily' | 'weekly' | 'spaced' | 'monthly' | 'everyN';

export interface Draft {
  id?: number;
  title: string;
  categoryId: string;
  mode: Mode;
  weekdays: number[];
  interval: string;
  monthDay: string;
  monthEvery: string;
  time: string;
  duration: string;
  /** Only in Ejercicios. */
  workoutKind?: WorkoutKind;
  place?: string;
  notes?: string;
}

export function modeOf(r: Routine): Mode {
  if (r.freq === 'monthly') return 'monthly';
  if (r.freq === 'weekly') return r.interval > 1 ? 'spaced' : r.weekdays.length === 7 ? 'daily' : 'weekly';
  return r.interval > 1 ? 'everyN' : 'daily';
}

/** What the server stores for a draft's "cada cuánto". */
export function scheduleOfDraft(d: Draft): { recurrence_freq: RoutineFreq; recurrence_interval: number; weekdays: number[]; month_day: number | null } {
  const n = Math.max(1, Math.trunc(Number(d.interval) || 1));
  const days = [...d.weekdays].sort((a, b) => a - b);
  switch (d.mode) {
    case 'daily':
      return { recurrence_freq: 'daily', recurrence_interval: 1, weekdays: [], month_day: null };
    case 'weekly':
      return { recurrence_freq: 'weekly', recurrence_interval: 1, weekdays: days, month_day: null };
    case 'spaced':
      return { recurrence_freq: 'weekly', recurrence_interval: Math.max(2, n), weekdays: days, month_day: null };
    case 'monthly':
      return { recurrence_freq: 'monthly', recurrence_interval: Math.max(1, Math.trunc(Number(d.monthEvery) || 1)), weekdays: [], month_day: Number(d.monthDay) };
    case 'everyN':
      return { recurrence_freq: 'daily', recurrence_interval: Math.max(2, n), weekdays: [], month_day: null };
  }
}

export function joinDays(days: number[]): string {
  const names = WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAY_NAMES[d]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}
