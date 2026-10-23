import { CATEGORIES_BY_TYPE, GARMENT_TYPES } from './taxonomy.js';
import type { GarmentType } from './taxonomy.js';
import type { OutfitContext } from './outfit/candidate-filter.js';

/**
 * How Fashion Mode names and draws things on WhatsApp: one emoji per kind of garment, colors and
 * occasions written the way people say them (not the taxonomy slugs), and the one-line summary of
 * what an outfit request was understood to ask for.
 */
const CATEGORY_EMOJI: Record<string, string> = {
  camiseta: '👕', camisa: '👔', polo: '👕', blusa: '👚', top: '🎽', sweater: '🧶', sudadera: '🧥', hoodie: '🧥', chaleco: '🦺',
  jeans: '👖', pantalon: '👖', chino: '👖', pantalon_vestir: '👖', jogger: '👖', short: '🩳', falda: '👗',
  vestido: '👗', enterizo: '🩱', traje: '🤵',
  chaqueta: '🧥', blazer: '🧥', abrigo: '🧥', impermeable: '☔', gabardina: '🧥',
  tenis: '👟', sneakers: '👟', zapatos: '👞', botas: '🥾', sandalias: '🩴', mocasines: '👞',
  reloj: '⌚', cinturon: '🪢', gorra: '🧢', sombrero: '👒', gafas: '🕶️', bolso: '👜', mochila: '🎒', corbata: '👔', bufanda: '🧣', joyeria: '💍', otros: '✨',
};
const TYPE_EMOJI: Record<GarmentType, string> = { TOP: '👕', BOTTOM: '👖', FULL_BODY: '👗', OUTERWEAR: '🧥', FOOTWEAR: '👟', ACCESSORY: '⌚' };

export const TYPE_TITLES: Record<GarmentType, string> = {
  TOP: 'Partes de arriba',
  BOTTOM: 'Partes de abajo',
  FULL_BODY: 'Vestidos y trajes',
  OUTERWEAR: 'Chaquetas y abrigos',
  FOOTWEAR: 'Calzado',
  ACCESSORY: 'Accesorios',
};

function typeEmoji(type: string): string {
  return TYPE_EMOJI[type as GarmentType] ?? '👕';
}

export function categoryEmoji(category: string, type?: string): string {
  return CATEGORY_EMOJI[category] ?? (type ? typeEmoji(type) : '👕');
}

export function categoryLabel(category: string): string {
  for (const type of GARMENT_TYPES) {
    const match = CATEGORIES_BY_TYPE[type].find((c) => c.value === category);
    if (match) return match.label;
  }
  return humanize(category);
}

/** 'azul_marino' -> 'azul marino', 'evento_semi_formal' -> 'evento semi formal'. */
export function humanize(slug: string): string {
  return slug.replace(/_/g, ' ');
}

const FEMININE = new Set(['camisa', 'camiseta', 'blusa', 'sudadera', 'falda', 'chaqueta', 'gabardina', 'gorra', 'corbata', 'bufanda', 'mochila', 'joyeria', 'botas', 'sandalias', 'gafas']);
const PLURAL = new Set(['jeans', 'tenis', 'sneakers', 'zapatos', 'botas', 'sandalias', 'mocasines', 'gafas']);

/** "jeans", "botas", "gafas" read as plural: "tus botas", "quedan fijas". */
export function isPluralGarment(category: string): boolean {
  return PLURAL.has(category);
}

/** The color the way it's said next to that garment: "camisa blanca", "zapatos negros", "botas rojas". */
export function colorFor(category: string, color: string): string {
  const [first, ...rest] = humanize(color).split(' ');
  let word = first;
  if (FEMININE.has(category) && /o$/.test(word) && word !== 'vino') word = `${word.slice(0, -1)}a`;
  if (PLURAL.has(category) && !['beige', 'vino', 'multicolor', 'naranja'].includes(word)) word = /[aeioué]$/.test(word) ? `${word}s` : /s$/.test(word) ? `${word}es` : `${word}es`;
  return [word, ...rest].join(' ');
}

/** "👔 Camisa blanca" - what a garment is called in every list and outfit. */
export function garmentLabel(g: { category: string; type?: string; color?: string | null; favorite?: number | boolean }): string {
  return `${categoryEmoji(g.category, g.type)} ${categoryLabel(g.category)}${g.color ? ` ${colorFor(g.category, g.color)}` : ''}${g.favorite ? ' ❤️' : ''}`;
}

const AVOID_ROLE_WORDS: Record<string, string> = { TOP: 'arriba', BOTTOM: 'abajo', FOOTWEAR: 'zapatos', OUTERWEAR: 'chaqueta', FULL_BODY: 'vestido', ACCESSORY: 'accesorios' };
const WEATHER_WORDS: Record<string, string> = { calido: 'clima cálido', templado: 'clima templado', frio: 'clima frío', lluvia: 'día de lluvia' };
const FORMALITY_WORDS: Record<string, string> = { muy_informal: 'muy informal', informal: 'informal', smart_casual: 'smart casual', formal: 'formal', muy_formal: 'muy formal' };

/**
 * What an outfit request was understood to ask for, as short chips: "boda · formal · clima frío ·
 * con blazer azul marino · sin corbata". Shown above every recommendation, so a request that was
 * read wrong is obvious at a glance and can be corrected. Empty when nothing specific was asked.
 */
export function describeRequest(ctx: OutfitContext): string {
  const parts: string[] = [];
  if (ctx.occasion) parts.push(humanize(ctx.occasion));
  if (ctx.formality) parts.push(FORMALITY_WORDS[ctx.formality] ?? humanize(ctx.formality));
  if (ctx.style && ctx.style !== ctx.formality) parts.push(`estilo ${humanize(ctx.style)}`);
  if (ctx.weather) parts.push(WEATHER_WORDS[ctx.weather] ?? humanize(ctx.weather));
  if (ctx.season && ctx.season !== 'todo_el_ano') parts.push(humanize(ctx.season));
  for (const must of ctx.mustHave ?? []) parts.push(`con ${categoryLabel(must.category).toLowerCase()}${must.color ? ` ${colorFor(must.category, must.color)}` : ''}`);
  if (ctx.colorsPreferred?.length) parts.push(`tonos ${ctx.colorsPreferred.map(humanize).join(', ')}`);
  for (const category of ctx.excludeCategories ?? []) parts.push(`sin ${categoryLabel(category).toLowerCase()}`);
  for (const rule of ctx.avoid ?? []) {
    const what = rule.category ? categoryLabel(rule.category).toLowerCase() : rule.role ? (AVOID_ROLE_WORDS[rule.role] ?? '') : '';
    parts.push(`${what ? `${what} ` : ''}nada ${rule.color ? humanize(rule.color) : ''}`.trim());
  }
  if (ctx.colorsAvoided?.length) parts.push(`nada de ${ctx.colorsAvoided.map(humanize).join(', ')}`);
  return parts.join(' · ');
}
