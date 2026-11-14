import { env } from '../../../config/env.js';
import { getAiClient } from '../../../agent/llm-provider.js';
import { aiUsageModel } from '../../../models/ai-usage.model.js';
import type { Brand } from '../publisher.types.js';
import type { DesignContent, DesignKind, DesignLayout, Identity } from './studio.types.js';

/**
 * The words of a design (headline, sub, points, button, and what the image should show), in the
 * brand's voice. With the text model they come from the brief; without it (or if it fails) from a
 * template built from the same brief and the brand profile - never empty.
 */
export interface Copy extends DesignContent {
  title: string;
  caption: string;
}

const clip = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function templateCopy(kind: DesignKind, layout: DesignLayout, brand: Brand, brief: string, variant = 0): Copy {
  const name = brand.name || 'Tu marca';
  const idea = clip(brief, 70) || (brand.keywords[0] ? `Todo sobre ${brand.keywords[0]}` : `Conoce ${name}`);
  const tags = brand.hashtags.slice(0, 5).map((t) => `#${t}`).join(' ');
  const caption = [idea, brand.cta, tags].filter(Boolean).join('\n\n');
  if (kind === 'logo' || kind === 'profile') return { title: `Logo de ${name}`, caption: '', headline: name, art_prompt: brief || brand.keywords.slice(0, 2).join(', ') };
  if (kind === 'cover') return { title: `Portada de ${name}`, caption: '', headline: name, sub: brand.audience || brand.keywords.slice(0, 3).join(' · '), art_prompt: brief || brand.keywords.slice(0, 3).join(', ') };
  const bullets = brand.keywords.slice(variant, variant + 3);
  return {
    title: idea,
    caption,
    headline: idea,
    sub: layout === 'quote' ? name : clip(brand.audience, 90),
    bullets: bullets.length === 3 ? bullets.map((b) => clip(b, 40)) : ['Fácil de usar', 'Ahorra tu tiempo', 'Pruébalo hoy'],
    cta: clip(brand.cta, 28) || 'Conócelo',
    art_prompt: brief || brand.keywords.slice(0, 3).join(', '),
  };
}

export async function writeCopy(userId: number | null, input: { kind: DesignKind; layout: DesignLayout; brand: Brand; identity: Identity; brief: string; avoid: string[]; variant: number }): Promise<Copy> {
  const fallback = templateCopy(input.kind, input.layout, input.brand, input.brief, input.variant);
  if (!env.ai.apiKey) return fallback;
  const { brand } = input;
  const want =
    input.kind === 'logo' || input.kind === 'profile'
      ? '{"art_prompt": "qué símbolo debe pintar el modelo de imagen, en inglés, 1 frase, sin texto"}'
      : input.kind === 'cover'
        ? '{"headline": "el nombre o lema (máx. 40 car.)", "sub": "una línea que diga qué ofreces (máx. 80)", "art_prompt": "escena de fondo en inglés, 1-2 frases, sin texto"}'
        : input.layout === 'tip'
          ? '{"headline": "titular del consejo (máx. 55)", "bullets": ["punto 1 (máx. 38)", "punto 2", "punto 3"], "cta": "botón (máx. 24)", "caption": "texto para publicar con la imagen, con llamada a la acción", "art_prompt": ""}'
          : input.layout === 'quote'
            ? '{"headline": "frase memorable (máx. 90)", "sub": "firma o contexto (máx. 50)", "cta": "", "caption": "texto para publicar con la imagen", "art_prompt": ""}'
            : '{"headline": "titular que detenga el scroll (máx. 60)", "sub": "apoyo (máx. 100)", "cta": "botón (máx. 24)", "caption": "texto para publicar con la imagen, con llamada a la acción", "art_prompt": "escena visual en inglés, 1-2 frases, sin texto ni logos"}';
  try {
    const { client, model } = getAiClient();
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `Eres director creativo de redes sociales. Escribes en ${brand.language === 'en' ? 'inglés' : 'español'}, en la voz de la marca, con frases cortas y concretas. Nunca inventes datos, precios ni promesas. Respondes SOLO un JSON.` },
        {
          role: 'user',
          content: [
            `Marca: ${brand.name || '(sin nombre)'}. Tono: ${brand.tone || 'cercano y claro'}. Público: ${brand.audience || 'general'}. Llamada a la acción: ${brand.cta || '(ninguna)'}. Palabras clave: ${brand.keywords.join(', ') || '(ninguna)'}.`,
            `Estilo visual: ${input.identity.style || 'moderno y limpio'}.`,
            `Pieza: ${input.kind}${input.kind === 'post' || input.kind === 'story' ? `, diseño «${input.layout}»` : ''}. Indicación: ${input.brief || '(libre: elige un ángulo útil para el público)'}.`,
            input.avoid.length ? `Ya se usaron estos titulares; toma otro ángulo: ${input.avoid.join(' | ')}.` : '',
            `Responde con este formato: ${want}`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      temperature: 0.85,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    });
    if (res.usage && userId) aiUsageModel.log(userId, 'publisher.studio', model, res.usage.prompt_tokens, res.usage.completion_tokens);
    const raw = JSON.parse(res.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
    const bullets = Array.isArray(raw.bullets) ? raw.bullets.map((b) => clip(b, 40)).filter(Boolean).slice(0, 4) : [];
    const headline = clip(raw.headline, 90) || fallback.headline;
    return {
      title: clip(raw.headline, 90) || fallback.title,
      headline,
      sub: clip(raw.sub, 110) || fallback.sub,
      bullets: input.layout === 'tip' ? (bullets.length >= 3 ? bullets : fallback.bullets) : undefined,
      cta: input.layout === 'quote' ? undefined : clip(raw.cta, 28) || fallback.cta,
      caption: clip(raw.caption, 600) || fallback.caption,
      art_prompt: clip(raw.art_prompt, 300) || fallback.art_prompt,
    };
  } catch (err) {
    console.log('[STUDIO] Copy from the model failed (%s); using the template', (err as Error).message);
    return fallback;
  }
}
