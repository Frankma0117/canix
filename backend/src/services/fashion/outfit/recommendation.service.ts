import { getAiClient } from '../../../agent/llm-provider.js';
import { aiUsageModel } from '../../../models/ai-usage.model.js';
import { garmentsModel } from '../../../models/garments.model.js';
import { env } from '../../../config/env.js';
import { GARMENT_TYPES } from '../taxonomy.js';
import { filterCandidates, matchesMust, type OutfitContext, type ScoredGarment } from './candidate-filter.js';
import { colorHarmony } from './sense.js';
import { typeForCategory } from '../taxonomy.js';
import { outerwearWanted, rememberShown, withOccasionNeeds } from './sense.js';
import { buildRuleBasedOutfit, validateAndFillPicks, type OutfitPick, type RuleBasedOutfit } from './rules.js';
import { buildRecommendationPrompt } from './prompts.js';
import { requestSignature, shownCombos as shownFor, rememberCombo } from './shown-combos.js';
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
 * Full pipeline: local filter/score (candidate-filter.ts, zero AI cost) -> optional model call
 * with ONLY the reduced candidate list (prompts.ts) -> strict validation against the real
 * candidate pool (rules.ts's validateAndFillPicks, the anti-hallucination gate). Never throws:
 * any AI failure falls back to the deterministic rule-based pick, so the person always gets a
 * real, valid outfit (or an honest "no tienes X" when the wardrobe can't cover a role).
 */
export async function recommendOutfit(userId: number, request: OutfitContext): Promise<RecommendationResult> {
  const allGarments = garmentsModel.listAllActive(userId);
  const sig = requestSignature(request);
  // What the occasion implies (how formal, what kinds of garment) when the request didn't say.
  const context = withOccasionNeeds(request);

  // Asking again is asking for something else: what was shown for this same request is avoided.
  const shownCombos = shownFor(userId, sig);

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

  rememberCombo(userId, sig, result.picks);
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

  // "Un outfit con esta camisa" / the garments kept on a swap: those exact garments go first,
  // before anything named by kind.
  const required = (context.requiredGarmentIds ?? []).map((id) => byId.get(id)).filter((g): g is ScoredGarment['garment'] => !!g);
  const requiredIds = new Set(required.map((g) => g.id));
  const wanted: { must?: { category: string; color?: string }; garment?: ScoredGarment['garment'] }[] = [
    ...required.map((garment) => ({ garment })),
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
    // a garment chosen by hand already holds this role - a same-kind "must" doesn't replace it
    if (!requiredIds.has(candidate.garment.id) && out.some((p) => requiredIds.has(p.garmentId) && p.role === role && role !== 'ACCESSORY')) continue;
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
    if (usage) aiUsageModel.log(userId, 'fashion_outfit', model, usage.prompt_tokens, usage.completion_tokens);

    const content = res.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as AiResponseShape;
    if (!Array.isArray(parsed.picks)) return null;

    const picks: OutfitPick[] = parsed.picks
      .filter((p) => GARMENT_TYPES.includes(p.role as GarmentType) && Number.isInteger(p.garmentId))
      .map((p) => ({ garmentId: p.garmentId, role: p.role as GarmentType }));

    return { picks, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch (err) {
    console.error('[FASHION] AI recommendation failed, using the deterministic pick:', (err as Error).message);
    return null;
  }
}

/**
 * "Cambia solo esta prenda": the rest of the outfit stays exactly as it is and the garment's role
 * gets the best alternative that fits the request and goes with what stays (color harmony).
 * Local and instant - no model call. Null when the wardrobe has no other option for that role.
 */
export function replaceGarment(
  userId: number,
  context: OutfitContext,
  picks: OutfitPick[],
  garmentId: number,
): { picks: OutfitPick[]; replacedRole: GarmentType } | null {
  const current = picks.find((p) => p.garmentId === garmentId);
  if (!current) return null;
  const kept = picks.filter((p) => p.garmentId !== garmentId);
  const all = garmentsModel.listAllActive(userId);
  const byType = filterCandidates(all, withOccasionNeeds({ ...context, requiredGarmentIds: [] }), env.fashion.ai.maxCandidatesPerRole, userId);
  const keptColors = kept.map((p) => all.find((g) => g.id === p.garmentId)?.color);
  let pool = byType[current.role].filter((c) => c.garment.id !== garmentId);
  // Garments swapped away earlier come back before giving up - better than an outfit without shoes.
  if (pool.length === 0 && context.excludeGarmentIds?.length) {
    const relaxed = filterCandidates(all, withOccasionNeeds({ ...context, requiredGarmentIds: [], excludeGarmentIds: [garmentId] }), env.fashion.ai.maxCandidatesPerRole, userId);
    pool = relaxed[current.role];
  }
  let best: ScoredGarment | undefined;
  let bestScore = -Infinity;
  for (const candidate of pool) {
    if (candidate.garment.id === garmentId || kept.some((p) => p.garmentId === candidate.garment.id)) continue;
    const total = candidate.score + keptColors.reduce((sum, color) => sum + colorHarmony(color, candidate.garment.color), 0);
    if (total > bestScore) {
      best = candidate;
      bestScore = total;
    }
  }
  if (!best) return null;
  const order: GarmentType[] = ['OUTERWEAR', 'TOP', 'FULL_BODY', 'BOTTOM', 'FOOTWEAR', 'ACCESSORY'];
  const next = [...kept, { garmentId: best.garment.id, role: current.role }].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  rememberShown(userId, [best.garment.id]);
  return { picks: next, replacedRole: current.role };
}
