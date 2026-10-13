import { FORMALITY, formalityIndex } from '../taxonomy.js';
import type { Garment } from '../../types/index.js';
import type { OutfitContext } from './candidate-filter.js';

/**
 * Common sense the outfit engine applies on top of whatever the wardrobe's tags say. The tags come
 * from an automatic classifier and are often wrong in ways a person never would be (a t-shirt
 * tagged "formal", an occasion nobody filled in), so the engine leans on what kind of garment
 * something IS - which is far more reliable - and only trusts a tag when it's plausible for it.
 */

/** How dressy each kind of garment normally is: 0 muy informal ... 4 muy formal. */
const CATEGORY_FORMALITY: Record<string, number> = {
  sudadera: 0, hoodie: 0, jogger: 0, short: 0, sandalias: 0, gorra: 0, mochila: 0,
  camiseta: 1, top: 1, jeans: 1, tenis: 1, sneakers: 1, chaqueta: 1, impermeable: 1,
  polo: 2, blusa: 2, sweater: 2, chino: 2, pantalon: 2, falda: 2, botas: 2, mocasines: 2, chaleco: 2, abrigo: 2, gabardina: 2,
  vestido: 2, enterizo: 2, reloj: 2, cinturon: 2, gafas: 2, bolso: 2, bufanda: 2, sombrero: 2, joyeria: 2, otros: 2,
  camisa: 3, pantalon_vestir: 3, blazer: 3, zapatos: 3, corbata: 3, traje: 3,
};

/** The garment's formality (0-4): its own tag when that's plausible for what it is, otherwise what it is. */
export function garmentFormality(g: Pick<Garment, 'category' | 'formality'>): number {
  const prior = CATEGORY_FORMALITY[g.category] ?? 2;
  const tagged = formalityIndex(g.formality);
  return tagged !== undefined && Math.abs(tagged - prior) <= 1 ? tagged : prior;
}

/** What an occasion asks for when the request didn't say how formal, what style or what weather. */
const OCCASION_NEEDS: Record<string, { formality: string; style?: string; weather?: string; likes?: string[] }> = {
  oficina: { formality: 'smart_casual', likes: ['camisa', 'polo', 'chino', 'pantalon', 'pantalon_vestir', 'blazer', 'mocasines', 'zapatos'] },
  entrevista: { formality: 'formal', likes: ['camisa', 'pantalon_vestir', 'blazer', 'zapatos'] },
  boda: { formality: 'formal', likes: ['camisa', 'pantalon_vestir', 'blazer', 'traje', 'vestido', 'zapatos'] },
  evento_formal: { formality: 'formal', likes: ['camisa', 'pantalon_vestir', 'blazer', 'traje', 'vestido', 'zapatos'] },
  evento_semi_formal: { formality: 'smart_casual', likes: ['camisa', 'polo', 'chino', 'blazer'] },
  cita: { formality: 'smart_casual', likes: ['camisa', 'polo', 'jeans', 'chino', 'botas'] },
  cena: { formality: 'smart_casual', likes: ['camisa', 'polo', 'chino', 'jeans'] },
  fiesta: { formality: 'smart_casual', style: 'urbano', likes: ['camisa', 'polo', 'camiseta', 'jeans', 'chaqueta', 'sneakers', 'tenis', 'botas'] },
  viaje: { formality: 'informal', likes: ['camiseta', 'hoodie', 'sudadera', 'jeans', 'jogger', 'tenis', 'sneakers', 'mochila'] },
  gimnasio: { formality: 'muy_informal', style: 'deportivo', likes: ['camiseta', 'top', 'sudadera', 'jogger', 'short', 'tenis', 'sneakers'] },
  playa: { formality: 'muy_informal', weather: 'calido', likes: ['camiseta', 'top', 'short', 'sandalias', 'gafas', 'sombrero', 'gorra'] },
  casual: { formality: 'informal', likes: ['camiseta', 'polo', 'jeans', 'tenis', 'sneakers'] },
};

/** The request with what its occasion implies filled in - what was said explicitly always wins. */
export function withOccasionNeeds(ctx: OutfitContext): OutfitContext & { likes?: string[] } {
  const needs = ctx.occasion ? OCCASION_NEEDS[ctx.occasion] : undefined;
  if (!needs) return ctx;
  return { ...ctx, formality: ctx.formality ?? needs.formality, style: ctx.style ?? needs.style, weather: ctx.weather ?? needs.weather, likes: needs.likes };
}

export function targetFormality(ctx: OutfitContext): number | undefined {
  return ctx.formality ? FORMALITY.indexOf(ctx.formality as (typeof FORMALITY)[number]) : undefined;
}

/**
 * Whether the outfit should have a jacket/coat at all. Not by default: one more layer on every
 * outfit (a coat for a night out) reads as wrong. It goes in when it was asked for, when it's
 * cold or raining, or when the look is formal enough to want a blazer.
 */
export function outerwearWanted(ctx: OutfitContext, hasBlazer: boolean): 'any' | 'blazer' | 'none' {
  if ((ctx.mustHave ?? []).some((m) => ['chaqueta', 'blazer', 'abrigo', 'impermeable', 'gabardina'].includes(m.category))) return 'any';
  if (ctx.weather === 'frio' || ctx.weather === 'lluvia') return 'any';
  if ((targetFormality(ctx) ?? 0) >= 3 && hasBlazer) return 'blazer';
  return 'none';
}

const NEUTRALS = new Set(['negro', 'blanco', 'gris', 'beige', 'azul_marino', 'café']);

/**
 * How well two garments' colors sit together, as a small score: a neutral goes with anything, two
 * different strong colors fight, and the same strong color head to toe is too much. Unknown or
 * "multicolor" says nothing either way.
 */
export function colorHarmony(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b || a === 'multicolor' || b === 'multicolor') return 0;
  const an = NEUTRALS.has(a);
  const bn = NEUTRALS.has(b);
  if (an && bn) return a === b && a !== 'negro' ? 0.2 : 0.6;
  if (an || bn) return 0.8;
  return a === b ? -0.8 : -0.5;
}

// What was shown lately, per person - so asking again gives something else. In memory on purpose:
// a restart forgetting it only means an outfit might repeat once.
const recentlyShown = new Map<number, number[]>();
const RECENT_LIMIT = 30;

export function recentPenalty(userId: number, garmentId: number): number {
  const recent = recentlyShown.get(userId) ?? [];
  const at = recent.lastIndexOf(garmentId);
  if (at < 0) return 0;
  // the more recently shown, the more it steps back
  return 0.6 + 1.4 * ((at + 1) / recent.length);
}

export function rememberShown(userId: number, garmentIds: number[]): void {
  const recent = [...(recentlyShown.get(userId) ?? []), ...garmentIds];
  recentlyShown.set(userId, recent.slice(-RECENT_LIMIT));
}
