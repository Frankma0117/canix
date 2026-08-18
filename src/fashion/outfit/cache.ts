import { env } from '../../config/env.js';
import type { Garment } from '../../types/index.js';
import type { RuleBasedOutfit } from './rules.js';

interface CacheEntry {
  result: RuleBasedOutfit & { reason: string; aiUsed: boolean };
  wardrobeHash: string;
  expiresAt: number;
  shownCombos: Set<string>;
}

/**
 * In-memory cache (same idiom as wa-manager.ts's seenMessageIds Set - lost on restart, which is
 * fine, this is purely a token-saving optimization, not data that needs to survive) so asking
 * "outfit para oficina" twice in a row doesn't re-call DeepSeek if nothing relevant changed. Keyed
 * by userId + a signature of the request context; invalidated automatically if the wardrobe
 * changed (see wardrobeHash) or the TTL passed - "dame otra opción" deliberately bypasses this
 * (see outfit.flow.ts) since the whole point there is a genuinely different result.
 */
const cache = new Map<string, CacheEntry>();

export function contextSignature(context: Record<string, unknown>): string {
  return JSON.stringify(context, Object.keys(context).sort());
}

/** Cheap, non-cryptographic hash of "has anything in the wardrobe changed" - just the sorted
 *  id+updated_at pairs joined; only needs to change when the underlying set of active garments or
 *  their fields do, not to be collision-resistant. */
export function wardrobeHash(garments: Garment[]): string {
  return garments
    .map((g) => `${g.id}:${g.updated_at}`)
    .sort()
    .join('|');
}

function cacheKey(userId: number, contextSig: string): string {
  return `${userId}:${contextSig}`;
}

export function getCached(userId: number, contextSig: string, currentWardrobeHash: string): CacheEntry | undefined {
  const entry = cache.get(cacheKey(userId, contextSig));
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now() || entry.wardrobeHash !== currentWardrobeHash) {
    cache.delete(cacheKey(userId, contextSig));
    return undefined;
  }
  return entry;
}

export function setCached(
  userId: number,
  contextSig: string,
  currentWardrobeHash: string,
  result: RuleBasedOutfit & { reason: string; aiUsed: boolean },
  shownCombos: Set<string>,
): void {
  cache.set(cacheKey(userId, contextSig), {
    result,
    wardrobeHash: currentWardrobeHash,
    expiresAt: Date.now() + env.fashion.ai.recommendationCacheTtlMs,
    shownCombos,
  });
}

export function getShownCombos(userId: number, contextSig: string): Set<string> {
  return cache.get(cacheKey(userId, contextSig))?.shownCombos ?? new Set();
}

export function comboSignature(picks: { garmentId: number }[]): string {
  return picks
    .map((p) => p.garmentId)
    .sort((a, b) => a - b)
    .join(',');
}
