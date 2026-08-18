import { getAiClient } from '../../agent/provider.js';
import { aiUsageRepo } from '../../db/repositories/ai-usage.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { env } from '../../config/env.js';
import { GARMENT_TYPES } from '../taxonomy.js';
import { filterCandidates, type OutfitContext, type ScoredGarment } from './candidate-filter.js';
import { buildRuleBasedOutfit, validateAndFillPicks, type OutfitPick, type RuleBasedOutfit } from './rules.js';
import { buildRecommendationPrompt } from './prompts.js';
import { contextSignature, wardrobeHash, getCached, setCached, getShownCombos, comboSignature } from './cache.js';
import type { GarmentType } from '../taxonomy.js';

export interface RecommendationResult extends RuleBasedOutfit {
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
export async function recommendOutfit(userId: number, context: OutfitContext, opts: { forceNew?: boolean } = {}): Promise<RecommendationResult> {
  const allGarments = garmentsRepo.listAllActive(userId);
  const hash = wardrobeHash(allGarments);
  const sig = contextSignature(context as Record<string, unknown>);

  if (!opts.forceNew) {
    const cached = getCached(userId, sig, hash);
    if (cached) {
      console.log('[FASHION] Recomendación servida desde cache para #%d (sin llamar a la IA).', userId);
      return { ...cached.result, emptyWardrobe: false };
    }
  }

  const byType = filterCandidates(allGarments, context, env.fashion.ai.maxCandidatesPerRole);
  const totalCandidates = GARMENT_TYPES.reduce((sum, t) => sum + byType[t].length, 0);

  if (totalCandidates === 0) {
    return { picks: [], missingRoles: [...GARMENT_TYPES], usedFullBody: false, reason: '', aiUsed: false, emptyWardrobe: true };
  }

  const shownCombos = opts.forceNew ? getShownCombos(userId, sig) : new Set<string>();
  const aiPicked = await tryAiRecommendation(userId, context, byType, [...shownCombos]);

  const result: RuleBasedOutfit & { reason: string; aiUsed: boolean } = aiPicked
    ? { ...validateAndFillPicks(aiPicked.picks, byType), reason: aiPicked.reason, aiUsed: true }
    : { ...buildRuleBasedOutfit(byType), reason: '', aiUsed: false };

  const newShown = new Set(shownCombos);
  newShown.add(comboSignature(result.picks));
  setCached(userId, sig, hash, result, newShown);

  return { ...result, emptyWardrobe: false };
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
