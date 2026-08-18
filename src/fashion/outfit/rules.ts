import { GARMENT_TYPES } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import type { ScoredGarment } from './candidate-filter.js';

export interface OutfitPick {
  garmentId: number;
  role: GarmentType;
}

export interface RuleBasedOutfit {
  picks: OutfitPick[];
  /** Roles that have no compatible candidate at all - e.g. "no tienes zapatos formales adecuados
   *  para esta ocasión" (verbatim example from the user's own spec) instead of silently omitting
   *  it or guessing. */
  missingRoles: GarmentType[];
  usedFullBody: boolean;
}

/**
 * Deterministic, zero-AI top pick per role - used both as the final answer when the AI call fails/
 * times out/is disabled, and as the fallback for any individual role the AI's response didn't
 * cover validly (see validateAndFillPicks below). Never delegates "is a top+bottom or a full-body
 * outfit more sensible here" to chance: a full-body piece (vestido/traje) is only used when there
 * isn't a good top+bottom pairing available, and the two are never mixed in one outfit.
 */
export function buildRuleBasedOutfit(byType: Record<GarmentType, ScoredGarment[]>): RuleBasedOutfit {
  const missing: GarmentType[] = [];
  const picks: OutfitPick[] = [];
  const usedFullBody = byType.FULL_BODY.length > 0 && (byType.TOP.length === 0 || byType.BOTTOM.length === 0);

  if (usedFullBody) {
    if (byType.FULL_BODY[0]) picks.push({ garmentId: byType.FULL_BODY[0].garment.id, role: 'FULL_BODY' });
    else missing.push('FULL_BODY');
  } else {
    if (byType.TOP[0]) picks.push({ garmentId: byType.TOP[0].garment.id, role: 'TOP' });
    else missing.push('TOP');
    if (byType.BOTTOM[0]) picks.push({ garmentId: byType.BOTTOM[0].garment.id, role: 'BOTTOM' });
    else missing.push('BOTTOM');
  }

  if (byType.FOOTWEAR[0]) picks.push({ garmentId: byType.FOOTWEAR[0].garment.id, role: 'FOOTWEAR' });
  else missing.push('FOOTWEAR');

  if (byType.OUTERWEAR[0]) picks.push({ garmentId: byType.OUTERWEAR[0].garment.id, role: 'OUTERWEAR' }); // optional, not "missing"
  for (const acc of byType.ACCESSORY.slice(0, 2)) picks.push({ garmentId: acc.garment.id, role: 'ACCESSORY' });

  return { picks, missingRoles: missing, usedFullBody };
}

/**
 * Validates the AI's proposed picks against the ACTUAL candidate pool it was given - this is the
 * hard anti-hallucination gate from the user's own spec ("si recomienda GARMENT_999, el backend
 * debe rechazarlo"). Any picked id that isn't in `byType`'s candidates for the role it claims is
 * dropped outright (never trusted, never silently "corrected" to something else). Also enforces
 * the full-body-vs-layered exclusivity rule server-side, since the AI could still get that wrong
 * even with a good prompt. Any role left empty after validation is backfilled from the rule-based
 * top pick for that role (see buildRuleBasedOutfit) - the user always gets a complete, valid
 * outfit back, never a broken partial one just because one AI-picked id didn't check out.
 */
export function validateAndFillPicks(aiPicks: OutfitPick[], byType: Record<GarmentType, ScoredGarment[]>): RuleBasedOutfit {
  const validById = new Map<number, GarmentType>();
  for (const type of GARMENT_TYPES) {
    for (const { garment } of byType[type]) validById.set(garment.id, type);
  }

  const valid = aiPicks.filter((p) => validById.get(p.garmentId) === p.role);
  const hasFullBody = valid.some((p) => p.role === 'FULL_BODY');
  const hasLayered = valid.some((p) => p.role === 'TOP' || p.role === 'BOTTOM');
  // If the AI mixed both branches, prefer whichever has more valid picks - drop the other branch
  // entirely rather than shipping an incoherent "vestido + pantalón" outfit.
  const filtered =
    hasFullBody && hasLayered
      ? valid.filter((p) => (valid.filter((v) => v.role === 'FULL_BODY').length >= valid.filter((v) => v.role === 'TOP' || v.role === 'BOTTOM').length ? p.role !== 'TOP' && p.role !== 'BOTTOM' : p.role !== 'FULL_BODY'))
      : valid;

  const fallback = buildRuleBasedOutfit(byType);
  const picks = [...filtered];
  const missing: GarmentType[] = [];

  const usedFullBody = filtered.some((p) => p.role === 'FULL_BODY') || (filtered.length === 0 && fallback.usedFullBody);
  const requiredRoles: GarmentType[] = usedFullBody ? ['FULL_BODY'] : ['TOP', 'BOTTOM'];

  for (const role of [...requiredRoles, 'FOOTWEAR' as GarmentType]) {
    if (picks.some((p) => p.role === role)) continue;
    const fromFallback = fallback.picks.find((p) => p.role === role);
    if (fromFallback) picks.push(fromFallback);
    else missing.push(role);
  }

  return { picks, missingRoles: missing, usedFullBody };
}
