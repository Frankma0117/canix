import { weekStartOf } from '../util/datetime.js';

/**
 * "Ya la usé esta semana": a garment marked as worn stays out of outfit suggestions until the week
 * turns over (Monday), unless the person asks for it by name. The mark is just the day it was worn
 * (garments.worn_on), so nothing has to be reset on Mondays.
 */
export function wornThisWeek(garment: { worn_on?: string | null }): boolean {
  return !!garment.worn_on && garment.worn_on >= weekStartOf();
}

export const WORN_TAG = '🔁 usada esta semana';
