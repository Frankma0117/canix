import { getAiClient } from '../../../agent/llm-provider.js';
import { aiUsageModel } from '../../../models/ai-usage.model.js';
import { OCCASIONS, FORMALITY, SEASONS, WEATHER, STYLES, isValidCategory, normalizeColor, typeForCategory } from '../taxonomy.js';
import { buildIntentPrompt } from './prompts.js';
import { parseRequestLocally, refineContext } from './request.js';
import type { OutfitContext } from './candidate-filter.js';

interface RawIntent {
  occasion?: string | null;
  formality?: string | null;
  season?: string | null;
  weather?: string | null;
  style?: string | null;
  colorsPreferred?: string[] | null;
  colorsAvoided?: string[] | null;
  mustHave?: { category?: string | null; color?: string | null }[] | null;
  excludeCategories?: string[] | null;
  avoid?: { category?: string | null; color?: string | null }[] | null;
}

const oneOf = (pool: readonly string[], value: string | null | undefined) => (value && pool.includes(value) ? value : undefined);
const colors = (list: string[] | null | undefined) => {
  const out = [...new Set((list ?? []).map((c) => normalizeColor(String(c))).filter((c): c is string => !!c))];
  return out.length ? out : undefined;
};

/** Keeps only what's in the wardrobe's own vocabulary - the model's answer is never trusted as is. */
function clean(raw: RawIntent): OutfitContext {
  const mustHave = (raw.mustHave ?? [])
    .filter((m) => m?.category && isValidCategory(m.category))
    .map((m) => ({ category: m.category as string, ...(m.color && normalizeColor(m.color) ? { color: normalizeColor(m.color) as string } : {}) }));
  const excludeCategories = (raw.excludeCategories ?? []).filter((c) => typeof c === 'string' && isValidCategory(c));
  // "que no tenga camiseta blanca" -> the top must not be white (see request.ts)
  const avoid = (raw.avoid ?? [])
    .filter((a) => a?.category && isValidCategory(a.category) && a.color && normalizeColor(a.color))
    .map((a) => ({ role: typeForCategory(a.category as string), color: normalizeColor(a.color as string) as string }));
  return {
    occasion: oneOf(OCCASIONS, raw.occasion),
    formality: oneOf(FORMALITY, raw.formality),
    season: oneOf(SEASONS, raw.season),
    weather: oneOf(WEATHER, raw.weather),
    style: oneOf(STYLES, raw.style),
    colorsPreferred: colors(raw.colorsPreferred),
    colorsAvoided: colors(raw.colorsAvoided),
    ...(mustHave.length ? { mustHave } : {}),
    ...(excludeCategories.length ? { excludeCategories } : {}),
    ...(avoid.length ? { avoid } : {}),
  };
}

/**
 * Turns an outfit request into a structured OutfitContext. A request made of things the wardrobe
 * already has words for - the occasion, how formal, the weather, garments to include or leave
 * out, colors ("boda de noche formal con blazer azul marino, sin corbata") - is read LOCALLY at
 * zero AI cost (see request.ts), however many of them it combines. Only when words are left over
 * that nothing here recognizes does one DeepSeek call read the sentence (see prompts.ts) - never
 * images, never conversation history - and even then whatever was read locally wins.
 */
export async function parseOutfitIntent(userId: number, text: string): Promise<OutfitContext> {
  const trimmed = text.trim();
  const local = parseRequestLocally(trimmed);
  if (local.leftover.length <= 1) {
    console.log('[FASHION] Request read locally (no AI): %s', JSON.stringify(local.context));
    return local.context;
  }

  try {
    const { client, model } = getAiClient();
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: buildIntentPrompt(trimmed) }],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const usage = res.usage;
    if (usage) aiUsageModel.log(userId, 'fashion_intent', model, usage.prompt_tokens, usage.completion_tokens);

    const content = res.choices[0]?.message?.content;
    if (!content) return local.context;
    const parsed = clean(JSON.parse(content) as RawIntent);
    console.log('[FASHION] Request read with AI (leftover: %s): %s', local.leftover.join(' '), JSON.stringify(parsed));
    return refineContext(parsed, local.context);
  } catch (err) {
    console.error('[FASHION] Could not read the request with AI, continuing with what was understood locally:', (err as Error).message);
    return local.context;
  }
}
