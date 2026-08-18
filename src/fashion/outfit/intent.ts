import { getAiClient } from '../../agent/provider.js';
import { aiUsageRepo } from '../../db/repositories/ai-usage.repo.js';
import { normalizeOccasion, normalizeColor } from '../taxonomy.js';
import { buildIntentPrompt } from './prompts.js';
import type { OutfitContext } from './candidate-filter.js';

interface RawIntent {
  occasion?: string | null;
  formality?: string | null;
  season?: string | null;
  weather?: string | null;
  style?: string | null;
  colorsPreferred?: string[] | null;
  colorsAvoided?: string[] | null;
}

function clean(raw: RawIntent): OutfitContext {
  return {
    occasion: raw.occasion ?? undefined,
    formality: raw.formality ?? undefined,
    season: raw.season ?? undefined,
    weather: raw.weather ?? undefined,
    style: raw.style ?? undefined,
    colorsPreferred: raw.colorsPreferred ?? undefined,
    colorsAvoided: raw.colorsAvoided ?? undefined,
  };
}

/**
 * Turns free text ("outfit para una boda", "algo fresco pero elegante para salir con mi novia")
 * into a structured OutfitContext. Structured requests (a single word/phrase that directly matches
 * a known occasion, e.g. "boda", "oficina") are resolved LOCALLY first, at zero AI cost - this is
 * the common case (the user's own spec explicitly lists "outfit oficina"/"outfit boda" as the
 * expected everyday phrasing). Only genuinely ambiguous/descriptive text falls through to a
 * DeepSeek call (see prompts.ts's buildIntentPrompt) - never images, never conversation history,
 * just this one line of text, minimizing tokens per the user's explicit priority.
 */
export async function parseOutfitIntent(userId: number, text: string): Promise<OutfitContext> {
  const trimmed = text.trim();
  const localOccasion = normalizeOccasion(trimmed);
  if (localOccasion) {
    console.log('[FASHION] Intención resuelta localmente (sin IA): occasion=%s', localOccasion);
    return { occasion: localOccasion };
  }
  const localColor = normalizeColor(trimmed);
  if (localColor) {
    return { colorsPreferred: [localColor] };
  }

  try {
    const { client, model } = getAiClient();
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: buildIntentPrompt(trimmed) }],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const usage = res.usage;
    if (usage) aiUsageRepo.log(userId, 'fashion_intent', model, usage.prompt_tokens, usage.completion_tokens);

    const content = res.choices[0]?.message?.content;
    if (!content) return {};
    const parsed = JSON.parse(content) as RawIntent;
    console.log('[FASHION] Intención clasificada por IA: %s', JSON.stringify(parsed));
    return clean(parsed);
  } catch (err) {
    console.error('[FASHION] No se pudo clasificar la intención con IA, sigo sin contexto extra:', (err as Error).message);
    return {};
  }
}
