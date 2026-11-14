import { env } from '../../config/env.js';
import { getAiClient } from '../../agent/llm-provider.js';
import { aiUsageModel } from '../../models/ai-usage.model.js';
import { PLATFORMS, PLATFORM_LIMITS, PLATFORM_NAMES, type Brand, type MediaType, type Platform, type SeoText } from './publisher.types.js';

/**
 * SEO per platform. With the text model, each platform gets a title, a description and hashtags in
 * the brand's voice; without it (or if it fails) a template built from the same brand profile -
 * so the panel always has something to suggest. The administrator edits whatever comes out.
 */

const PLATFORM_HINT: Record<Platform, string> = {
  youtube: 'Título con la palabra clave al inicio; descripción larga: primera línea gancho, resumen, llamada a la acción y hashtags al final. Sirve para búsqueda.',
  instagram: 'Primera línea que enganche antes del «ver más»; párrafos cortos, emojis con medida, llamada a la acción y hashtags al final.',
  facebook: 'Tono cercano y conversacional; pocas etiquetas; una llamada a la acción clara.',
  tiktok: 'Muy corto y directo; gancho en la primera palabra; pocos hashtags de tendencia más los de marca.',
};

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+\n/g, '\n').trim().slice(0, max);

export function normalizeHashtags(list: unknown, max: number): string[] {
  const arr = Array.isArray(list) ? list : String(list ?? '').split(/[\s,]+/);
  const out: string[] = [];
  for (const raw of arr) {
    const tag = String(raw).trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Trims one platform's texts to its limits. */
export function fit(platform: Platform, t: Partial<SeoText>): SeoText {
  const lim = PLATFORM_LIMITS[platform];
  return { title: clean(t.title, lim.title), description: clean(t.description, lim.description), hashtags: normalizeHashtags(t.hashtags, lim.hashtags) };
}

export function templateSeo(brand: Brand, base: { title: string; description: string; hashtags: string[]; keywords: string[] }, platform: Platform): SeoText {
  const tags = normalizeHashtags([...base.hashtags, ...brand.hashtags, ...base.keywords, ...brand.keywords], PLATFORM_LIMITS[platform].hashtags);
  const key = base.keywords[0] ?? brand.keywords[0] ?? '';
  const title = platform === 'youtube' && key && !base.title.toLowerCase().includes(key.toLowerCase()) ? `${key}: ${base.title}` : base.title;
  const parts = [base.description || base.title, brand.cta, brand.name ? `— ${brand.name}` : ''].filter(Boolean);
  const long = platform === 'youtube' && brand.keywords.length ? `\n\nTemas: ${[...base.keywords, ...brand.keywords].slice(0, 8).join(', ')}` : '';
  return fit(platform, { title, description: parts.join('\n\n') + long, hashtags: tags });
}

export interface SeoInput {
  title: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  mediaType: MediaType;
}

export async function generateSeo(brand: Brand, input: SeoInput, platforms: Platform[], userId: number | null): Promise<{ seo: Partial<Record<Platform, SeoText>>; usedAi: boolean }> {
  const fallback = Object.fromEntries(platforms.map((p) => [p, templateSeo(brand, input, p)])) as Partial<Record<Platform, SeoText>>;
  if (!env.ai.apiKey || !platforms.length) return { seo: fallback, usedAi: false };
  try {
    const { client, model } = getAiClient();
    const system = `Eres especialista en SEO y contenido para redes sociales. Escribes en ${brand.language === 'en' ? 'inglés' : 'español'}, en la voz de la marca. Respondes SOLO un JSON.`;
    const prompt = [
      `Marca: ${brand.name || '(sin nombre)'}. Tono: ${brand.tone || 'cercano y claro'}. Público: ${brand.audience || 'general'}. Llamada a la acción habitual: ${brand.cta || '(ninguna)'}.`,
      `Palabras clave de la marca: ${brand.keywords.join(', ') || '(ninguna)'}. Hashtags de la marca: ${brand.hashtags.join(', ') || '(ninguno)'}.`,
      `Pieza (${input.mediaType === 'video' ? 'video' : 'imagen'}): título «${input.title}». Descripción: ${input.description || '(sin descripción)'}. Palabras clave de esta pieza: ${input.keywords.join(', ') || '(ninguna)'}.`,
      `Escribe una versión para cada plataforma, sin inventar datos, precios ni promesas que la pieza no tenga:`,
      ...platforms.map((p) => `- ${p} (${PLATFORM_NAMES[p]}): ${PLATFORM_HINT[p]} Máx. título ${PLATFORM_LIMITS[p].title}, descripción ${PLATFORM_LIMITS[p].description}, hasta ${PLATFORM_LIMITS[p].hashtags} hashtags (sin #).`),
      `Formato: {"youtube": {"title": "", "description": "", "hashtags": []}, ...} solo con las plataformas pedidas.`,
    ].join('\n');
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    });
    if (res.usage && userId) aiUsageModel.log(userId, 'publisher.seo', model, res.usage.prompt_tokens, res.usage.completion_tokens);
    const raw = JSON.parse(res.choices[0]?.message?.content ?? '{}') as Record<string, Partial<SeoText>>;
    const seo: Partial<Record<Platform, SeoText>> = {};
    for (const p of platforms) {
      const r = raw[p];
      seo[p] = r && clean(r.title, 200) ? fit(p, r) : fallback[p]!;
    }
    return { seo, usedAi: true };
  } catch (err) {
    console.log('[PUBLISHER] SEO from the model failed (%s); using the template', (err as Error).message);
    return { seo: fallback, usedAi: false };
  }
}

export const isPlatform = (v: unknown): v is Platform => PLATFORMS.includes(v as Platform);
