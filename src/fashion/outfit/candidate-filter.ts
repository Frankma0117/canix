import { formalityIndex, GARMENT_TYPES } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import type { Garment } from '../../types/index.js';

export interface OutfitContext {
  occasion?: string;
  formality?: string;
  season?: string;
  weather?: string;
  style?: string;
  colorsPreferred?: string[];
  colorsAvoided?: string[];
  /** "hazme un outfit con esta camisa" - this garment MUST be included, others are filtered/scored
   *  around it instead of independently (see rules.ts). */
  requiredGarmentId?: number;
}

export interface ScoredGarment {
  garment: Garment;
  score: number;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** True when a garment's formality/season/weather is clearly incompatible with the request - these
 *  are hard excludes, not just a lower score (e.g. a formality gap of 2+ notches, per the user's
 *  own "reglas determinísticas" requirement - not everything should be left to the AI to notice). */
function isHardExcluded(garment: Garment, ctx: OutfitContext): boolean {
  if (ctx.formality) {
    const requested = formalityIndex(ctx.formality);
    const actual = formalityIndex(garment.formality);
    if (requested !== undefined && actual !== undefined && Math.abs(requested - actual) >= 2) return true;
  }
  if (ctx.season) {
    const seasons = parseJsonArray(garment.season);
    if (seasons.length > 0 && !seasons.includes(ctx.season) && !seasons.includes('todo_el_ano')) return true;
  }
  if (ctx.weather) {
    const weathers = parseJsonArray(garment.weather);
    if (weathers.length > 0 && !weathers.includes(ctx.weather)) return true;
  }
  if (ctx.colorsAvoided?.length && garment.color && ctx.colorsAvoided.includes(garment.color)) return true;
  return false;
}

function score(garment: Garment, ctx: OutfitContext): number {
  let s = 1;

  if (ctx.occasion) {
    const occasions = parseJsonArray(garment.occasions);
    if (occasions.includes(ctx.occasion)) s += 2;
  }
  if (ctx.formality) {
    const requested = formalityIndex(ctx.formality);
    const actual = formalityIndex(garment.formality);
    if (requested !== undefined && actual !== undefined) {
      const gap = Math.abs(requested - actual);
      s += gap === 0 ? 1.5 : gap === 1 ? 0.5 : 0;
    }
  }
  if (ctx.style) {
    const styles = parseJsonArray(garment.style);
    if (styles.includes(ctx.style)) s += 1;
  }
  if (ctx.colorsPreferred?.length && garment.color && ctx.colorsPreferred.includes(garment.color)) s += 1;
  if (garment.favorite) s += 0.25; // small nudge toward things the user already likes

  return s;
}

/** Local, zero-AI-cost filtering + scoring + grouping by type - the "150 prendas -> 40 -> 20 -> 10"
 *  reduction from the user's own spec happens entirely here, before anything is ever sent to
 *  DeepSeek (see recommendation.service.ts, which only receives the capped output of this). */
export function filterCandidates(all: Garment[], ctx: OutfitContext, maxPerGroup: number): Record<GarmentType, ScoredGarment[]> {
  const byType: Record<GarmentType, ScoredGarment[]> = {
    TOP: [],
    BOTTOM: [],
    FULL_BODY: [],
    OUTERWEAR: [],
    FOOTWEAR: [],
    ACCESSORY: [],
  };

  for (const garment of all) {
    const type = garment.type as GarmentType;
    if (!GARMENT_TYPES.includes(type)) continue;
    if (garment.id !== ctx.requiredGarmentId && isHardExcluded(garment, ctx)) continue;
    byType[type].push({ garment, score: garment.id === ctx.requiredGarmentId ? Infinity : score(garment, ctx) });
  }

  for (const type of GARMENT_TYPES) {
    byType[type].sort((a, b) => b.score - a.score);
    byType[type] = byType[type].slice(0, maxPerGroup);
  }

  return byType;
}
