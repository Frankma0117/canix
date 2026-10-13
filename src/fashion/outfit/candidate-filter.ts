import { formalityIndex, GARMENT_TYPES } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import type { Garment } from '../../types/index.js';
import { garmentFormality, recentPenalty } from './sense.js';

export interface OutfitContext {
  occasion?: string;
  formality?: string;
  season?: string;
  weather?: string;
  style?: string;
  colorsPreferred?: string[];
  colorsAvoided?: string[];
  /** "con el blazer azul marino", "con tenis": kinds of garment the outfit must include, optionally
   *  in a given color (see outfit/request.ts). Enforced after picking (recommendation.service.ts). */
  mustHave?: { category: string; color?: string }[];
  /** "sin corbata", "sin chaqueta": kinds of garment that must not appear at all. */
  excludeCategories?: string[];
  /** "hazme un outfit con esta camisa" - this garment MUST be included, others are filtered/scored
   *  around it instead of independently (see rules.ts). */
  requiredGarmentId?: number;
  /** From the user's own stored profile (see fashion-profile.repo.ts / users.gender) - 'hombre' or
   *  'mujer'. A garment explicitly tagged for the OTHER gender is hard-excluded; unisex or untagged
   *  (null) garments are always eligible regardless. Never set from free-text per-request wording -
   *  this is an identity fact from the profile, not something a single outfit request overrides. */
  genderFilter?: string;
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
    // By what the garment is, not only by its tag (see sense.ts): a hoodie is out of a formal look,
    // a t-shirt tagged "formal" by the classifier isn't suddenly in.
    const requested = formalityIndex(ctx.formality);
    if (requested !== undefined && Math.abs(requested - garmentFormality(garment)) >= 3) return true;
  }
  if (ctx.season) {
    const seasons = parseJsonArray(garment.season);
    if (seasons.length > 0 && !seasons.includes(ctx.season) && !seasons.includes('todo_el_ano')) return true;
  }
  if (ctx.weather) {
    const weathers = parseJsonArray(garment.weather);
    if (weathers.length > 0 && !weathers.includes(ctx.weather)) return true;
  }
  if (ctx.excludeCategories?.includes(garment.category)) return true;
  if (ctx.colorsAvoided?.length && garment.color && ctx.colorsAvoided.includes(garment.color)) return true;
  if (ctx.genderFilter && garment.gender && garment.gender !== 'unisex' && garment.gender !== ctx.genderFilter) return true;
  return false;
}

/** True when this garment is one the request asked for by name (and in that color, if it said one). */
export function matchesMust(garment: Garment, must: { category: string; color?: string }): boolean {
  return garment.category === must.category && (!must.color || garment.color === must.color);
}

function score(garment: Garment, ctx: OutfitContext): number {
  let s = 1;

  // A garment asked for by name outranks everything else in its role; the right kind in another
  // color still beats an unrelated garment.
  for (const must of ctx.mustHave ?? []) {
    if (matchesMust(garment, must)) s += 10;
    else if (garment.category === must.category) s += 4;
  }

  if (ctx.occasion) {
    const occasions = parseJsonArray(garment.occasions);
    if (occasions.includes(ctx.occasion)) s += 2;
  }
  if (ctx.formality) {
    const requested = formalityIndex(ctx.formality);
    if (requested !== undefined) {
      const gap = Math.abs(requested - garmentFormality(garment));
      s += gap === 0 ? 2 : gap === 1 ? 1 : gap === 2 ? -0.5 : -2;
    }
  }
  // The kinds of garment the occasion calls for (a shirt for the office, trainers for the gym).
  if ((ctx as { likes?: string[] }).likes?.includes(garment.category)) s += 1.5;
  if (ctx.weather === 'lluvia' && garment.category === 'impermeable') s += 3;
  if (ctx.weather === 'frio' && ['abrigo', 'chaqueta', 'sweater', 'hoodie', 'sudadera', 'botas', 'bufanda'].includes(garment.category)) s += 1.5;
  if (ctx.weather === 'calido' && ['abrigo', 'sweater', 'hoodie', 'sudadera', 'botas', 'bufanda', 'gabardina'].includes(garment.category)) s -= 2;
  if (ctx.style) {
    const styles = parseJsonArray(garment.style);
    if (styles.includes(ctx.style)) s += 1;
  }
  if (ctx.colorsPreferred?.length && garment.color && ctx.colorsPreferred.includes(garment.color)) s += 0.75;
  if (garment.favorite) s += 0.25; // small nudge toward things the user already likes

  return s;
}

/** Local, zero-AI-cost filtering + scoring + grouping by type - the "150 prendas -> 40 -> 20 -> 10"
 *  reduction from the user's own spec happens entirely here, before anything is ever sent to
 *  DeepSeek (see recommendation.service.ts, which only receives the capped output of this). */
/**
 * `vary` (the person's id) makes two askings differ: what was shown lately steps back, and near-ties
 * are broken at random instead of always by the same garment (the first row in the table).
 */
export function filterCandidates(all: Garment[], ctx: OutfitContext, maxPerGroup: number, vary?: number): Record<GarmentType, ScoredGarment[]> {
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
    // What was asked for by name stays in even if its tags don't fit the occasion - the person chose it.
    const asked = (ctx.mustHave ?? []).some((m) => m.category === garment.category) && !ctx.excludeCategories?.includes(garment.category);
    if (garment.id !== ctx.requiredGarmentId && !asked && isHardExcluded(garment, ctx)) continue;
    const variation = vary === undefined ? 0 : Math.random() * 0.9 - recentPenalty(vary, garment.id);
    byType[type].push({ garment, score: garment.id === ctx.requiredGarmentId ? Infinity : score(garment, ctx) + variation });
  }

  for (const type of GARMENT_TYPES) {
    byType[type].sort((a, b) => b.score - a.score);
    byType[type] = byType[type].slice(0, maxPerGroup);
  }

  return byType;
}
