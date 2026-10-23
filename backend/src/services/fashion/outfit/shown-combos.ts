import { env } from '../../../config/env.js';

/**
 * Which garment combinations were already shown for a given request, so asking the same thing
 * again (or "otra opción") gets something different. In memory on purpose - losing it on restart
 * only means a combination may be repeated once. Entries expire after
 * FASHION_RECOMMENDATION_CACHE_TTL_MS.
 */
const shown = new Map<string, { combos: Set<string>; expiresAt: number }>();

/** A request's identity: its fields with sorted keys (nested values kept whole). */
export function requestSignature(context: object): string {
  return JSON.stringify(Object.fromEntries(Object.entries(context).sort(([a], [b]) => a.localeCompare(b))));
}

/** "12,30,41": the same garments in any order are the same combination. */
export function comboSignature(picks: { garmentId: number }[]): string {
  return picks
    .map((p) => p.garmentId)
    .sort((a, b) => a - b)
    .join(',');
}

export function shownCombos(userId: number, requestSig: string): Set<string> {
  const entry = shown.get(`${userId}:${requestSig}`);
  return entry && entry.expiresAt > Date.now() ? entry.combos : new Set();
}

export function rememberCombo(userId: number, requestSig: string, picks: { garmentId: number }[]): void {
  const key = `${userId}:${requestSig}`;
  const combos = new Set(shownCombos(userId, requestSig));
  combos.add(comboSignature(picks));
  shown.set(key, { combos, expiresAt: Date.now() + env.fashion.ai.recommendationCacheTtlMs });
}
