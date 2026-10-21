import { getAiClient } from '../../agent/provider.js';
import { aiUsageRepo } from '../../db/repositories/ai-usage.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { env } from '../../config/env.js';
import { GARMENT_TYPES } from '../taxonomy.js';
import { filterCandidates, matchesMust, type OutfitContext, type ScoredGarment } from './candidate-filter.js';
import { typeForCategory } from '../taxonomy.js';
import { outerwearWanted, rememberShown, withOccasionNeeds } from './sense.js';
import { buildRuleBasedOutfit, validateAndFillPicks, type OutfitPick, type RuleBasedOutfit } from './rules.js';
import { buildRecommendationPrompt } from './prompts.js';
import { contextSignature, wardrobeHash, setCached, getShownCombos, comboSignature } from './cache.js';
import type { GarmentType } from '../taxonomy.js';

export interface RecommendationResult extends RuleBasedOutfit {
  /** Garments the request asked for by name that the wardrobe simply doesn't have. */
  missingMust?: { category: string; color?: string }[];
  reason: string;
  aiUsed: boolean;
  /** True when there were literally zero candidates in any role - nothing to recommend at all. */
  emptyWardrobe: boolean;
}

interface AiResponseShape {
  picks?: { garmentId: number; role: string }[];
  reason?: string;
}

/**
 * Full pipeline: local filter/score (candidate-filter.ts, zero AI cost) -> optional DeepSeek call
 * with ONLY the reduced candidate list (prompts.ts) -> strict validation against the real
 * candidate pool (rules.ts's validateAndFillPicks, the anti-hallucination gate) -> cache (cache.ts).
 * Never throws: any AI failure silently falls back to the deterministic rule-based pick, so the
 * user always gets a real, valid outfit back (or an honest "no tienes X adecuado" if the wardrobe
 * genuinely can't cover a role) - see the user's own "REGLA CRÍTICA CONTRA ALUCINACIONES" and
 * error-handling requirements.
 */
export async function recommendOutfit(userId: number, request: OutfitContext, opts: { forceNew?: boolean } = {}): Promise<RecommendationResult> {
  const allGarments = garmentsRepo.listAllActive(userId);
  const hash = wardrobeHash(allGarments);
  const sig = contextSignature(request as Record<string, unknown>);
  // What the occasion implies (how formal, what kinds of garment) when the request didn't say.
  const context = withOccasionNeeds(request);

  // No answer is replayed from a cache: asking again is asking for something else. What was shown
  // for this same request is remembered so the next one differs.
  const shownCombos = getShownCombos(userId, sig);
  void opts;

  const byType = filterCandidates(allGarments, context, env.fashion.ai.maxCandidatesPerRole, userId);
  const totalCandidates = GARMENT_TYPES.reduce((sum, t) => sum + byType[t].length, 0);

  if (totalCandidates === 0) {
    return { picks: [], missingRoles: [...GARMENT_TYPES], usedFullBody: false, reason: '', aiUsed: false, emptyWardrobe: allGarments.length === 0 };
  }

  // A jacket or coat only when the request, the weather or the formality calls for one.
  const outer = outerwearWanted(context, byType.OUTERWEAR.some((c) => c.garment.category === 'blazer'));
  if (outer === 'none') byType.OUTERWEAR = [];
  else if (outer === 'blazer') byType.OUTERWEAR = byType.OUTERWEAR.filter((c) => c.garment.category === 'blazer');

  const aiPicked = await tryAiRecommendation(userId, context, byType, [...shownCombos]);

  const preferFullBody = (context.mustHave ?? []).some((m) => typeForCategory(m.category) === 'FULL_BODY');
  const picked: RuleBasedOutfit & { reason: string; aiUsed: boolean } = aiPicked
    ? { ...validateAndFillPicks(aiPicked.picks, byType, { preferFullBody }), reason: aiPicked.reason, aiUsed: true }
    : { ...buildRuleBasedOutfit(byType, { preferFullBody }), reason: '', aiUsed: false };
  const result = { ...picked, ...enforceMustHave(picked.picks, byType, context) };

  const newShown = new Set(shownCombos);
  newShown.add(comboSignature(result.picks));
  setCached(userId, sig, hash, result, newShown);
  rememberShown(userId, result.picks.map((p) => p.garmentId));

  return { ...result, emptyWardrobe: false };
}

/**
 * Makes sure every garment the request named is actually in the outfit: the model (or the
 * top-score rule) may have picked something else for that role. For each one asked for, the best
 * matching candidate takes its role's place (accessories are added alongside); the ones the
 * wardrobe doesn't have at all are reported, never silently swapped for something similar.
 */
function enforceMustHave(
  picks: OutfitPick[],
  byType: Record<GarmentType, ScoredGarment[]>,
  context: OutfitContext,
): { picks: OutfitPick[]; missingMust: { category: string; color?: string }[] } {
  let out = [...picks];
  const missingMust: { category: string; color?: string }[] = [];
  const byId = new Map<number, ScoredGarment['garment']>();
  for (const type of GARMENT_TYPES) for (const { garment } of byType[type]) byId.set(garment.id, garment);

  // "Un outfit con esta camisa": that exact garment goes first, before anything named by kind.
  const required = context.requiredGarmentId !== undefined ? byId.get(context.requiredGarmentId) : undefined;
  const wanted: { must?: { category: string; color?: string }; garment?: ScoredGarment['garment'] }[] = [
    ...(required ? [{ garment: required }] : []),
    ...(context.mustHave ?? []).map((must) => ({ must })),
  ];

  for (const want of wanted) {
    const must = want.must ?? { category: want.garment!.category };
    const role = (want.garment?.type as GarmentType | undefined) ?? typeForCategory(must.category);
    if (!role) continue;
    const candidate = want.garment
      ? { garment: want.garment }
      : (byType[role].find((c) => matchesMust(c.garment, must)) ?? byType[role].find((c) => c.garment.category === must.category));
    if (!candidate) {
      missingMust.push(must);
      continue;
    }
    if (!want.garment && !matchesMust(candidate.garment, must)) missingMust.push(must); // right kind, but not in that color
    if (out.some((p) => p.garmentId === candidate.garment.id)) continue;
    // the garment chosen by hand already holds this role - a same-kind "must" doesn't replace it
    if (required && candidate.garment.id !== required.id && out.some((p) => p.garmentId === required.id && p.role === role && role !== 'ACCESSORY')) continue;
    if (role === 'ACCESSORY') out.push({ garmentId: candidate.garment.id, role });
    else if (role === 'FULL_BODY') out = [...out.filter((p) => p.role !== 'TOP' && p.role !== 'BOTTOM' && p.role !== 'FULL_BODY'), { garmentId: candidate.garment.id, role }];
    else {
      // a named top/bottom can't sit next to a full-body piece - the named garment wins
      const kept = out.filter((p) => p.role !== role && !(p.role === 'FULL_BODY' && (role === 'TOP' || role === 'BOTTOM')));
      out = [...kept, { garmentId: candidate.garment.id, role }];
    }
  }

  const order: GarmentType[] = ['OUTERWEAR', 'TOP', 'FULL_BODY', 'BOTTOM', 'FOOTWEAR', 'ACCESSORY'];
  out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return { picks: out.filter((p) => byId.has(p.garmentId)), missingMust };
}

async function tryAiRecommendation(
  userId: number,
  context: OutfitContext,
  byType: Record<GarmentType, ScoredGarment[]>,
  avoidCombos: string[],
): Promise<{ picks: OutfitPick[]; reason: string } | null> {
  try {
    const { client, model } = getAiClient();
    const candidatesForPrompt: Record<string, { id: number; category: string; color: string | null; style: string | null }[]> = {};
    for (const type of GARMENT_TYPES) {
      candidatesForPrompt[type] = byType[type].map(({ garment }) => ({
        id: garment.id,
        category: garment.category,
        color: garment.color,
        style: garment.style,
      }));
    }

    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: buildRecommendationPrompt(context, candidatesForPrompt, avoidCombos) }],
      temperature: 0.4,
      max_tokens: env.fashion.ai.maxOutputTokens,
      response_format: { type: 'json_object' },
    });

    const usage = res.usage;
    if (usage) aiUsageRepo.log(userId, 'fashion_outfit', model, usage.prompt_tokens, usage.completion_tokens);

    const content = res.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as AiResponseShape;
    if (!Array.isArray(parsed.picks)) return null;

    const picks: OutfitPick[] = parsed.picks
      .filter((p) => GARMENT_TYPES.includes(p.role as GarmentType) && Number.isInteger(p.garmentId))
      .map((p) => ({ garmentId: p.garmentId, role: p.role as GarmentType }));

    return { picks, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch (err) {
    console.error('[FASHION] Recomendación por IA falló, uso el pick determinístico:', (err as Error).message);
    return null;
  }
}
