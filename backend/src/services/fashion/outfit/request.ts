import { COLORS, allCategoryValues, typeForCategory } from '../taxonomy.js';
import type { OutfitContext } from './candidate-filter.js';

/**
 * Reads a specific outfit request locally, with no AI call: the occasion, how formal, the weather,
 * the style, the garments it must include ("con el blazer azul marino", "con tenis blancos"), the
 * ones it must not ("sin corbata") and the colors to prefer or avoid - all in one sentence, in any
 * order. Only words that are in the wardrobe's own vocabulary are understood; whatever is left
 * over is reported back, so the caller can decide whether the model needs to read the rest.
 */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?¿¡"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** phrase (already plain, singular) -> taxonomy value. Longest phrases are matched first. */
function vocabulary(entries: Record<string, string[]>): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [value, phrases] of Object.entries(entries)) for (const phrase of phrases) pairs.push([phrase, value]);
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

const OCCASION_WORDS = vocabulary({
  oficina: ['oficina', 'trabajo', 'trabajar', 'reunion de trabajo'],
  entrevista: ['entrevista'],
  boda: ['boda', 'matrimonio', 'casamiento'],
  cita: ['cita', 'date', 'salir con mi novia', 'salir con mi novio', 'salir con mi pareja'],
  cena: ['cena', 'cenar', 'restaurante', 'comida elegante'],
  fiesta: ['fiesta', 'rumba', 'discoteca', 'cumpleanos', 'celebracion'],
  viaje: ['viaje', 'viajar', 'aeropuerto', 'vuelo'],
  gimnasio: ['gimnasio', 'gym', 'entrenar', 'hacer ejercicio', 'correr'],
  playa: ['playa', 'piscina', 'mar'],
  evento_formal: ['evento formal', 'gala', 'grado', 'graduacion', 'ceremonia'],
  evento_semi_formal: ['evento semi formal', 'semi formal', 'semiformal', 'coctel'],
  casual: ['dia a dia', 'diario', 'salir a caminar', 'centro comercial', 'ir al cine', 'cine'],
});
const FORMALITY_WORDS = vocabulary({
  muy_formal: ['muy formal', 'de etiqueta', 'gala', 'super elegante', 'muy elegante'],
  formal: ['formal', 'elegante', 'bien presentado', 'de vestir'],
  smart_casual: ['smart casual', 'semi formal', 'semiformal', 'casual elegante', 'arreglado pero comodo'],
  informal: ['informal', 'relajado', 'comodo', 'sencillo', 'descomplicado'],
  muy_informal: ['muy informal', 'para estar en casa', 'de casa'],
});
const WEATHER_WORDS = vocabulary({
  frio: ['frio', 'helado', 'helando', 'invierno', 'abrigado'],
  calido: ['calor', 'calido', 'caluroso', 'caliente', 'soleado', 'fresco', 'verano'],
  lluvia: ['lluvia', 'lloviendo', 'lluvioso', 'llueve', 'aguacero'],
  templado: ['templado', 'clima normal'],
});
const STYLE_WORDS = vocabulary({
  deportivo: ['deportivo', 'sport', 'sporty'],
  urbano: ['urbano', 'street', 'streetwear'],
  clasico: ['clasico', 'tradicional'],
  minimalista: ['minimalista', 'minimal', 'sobrio'],
  bohemio: ['bohemio', 'boho'],
  casual: ['casual'],
});
const COLOR_WORDS = vocabulary({
  ...Object.fromEntries(COLORS.map((c) => [c, [plain(c.replace(/_/g, ' '))]])),
  'café': ['cafe', 'marron', 'cafes', 'marrones'],
  azul_marino: ['azul marino', 'azul oscuro', 'navy'],
  azul_claro: ['azul claro', 'celeste', 'azul cielo'],
  verde_oliva: ['verde oliva', 'verde militar', 'oliva'],
  rosado: ['rosado', 'rosa', 'rosada'],
  vino: ['vino', 'vinotinto', 'burdeos'],
  gris: ['gris', 'grises', 'plomo'],
  blanco: ['blanco', 'blanca', 'blancos', 'blancas'],
  negro: ['negro', 'negra', 'negros', 'negras'],
  rojo: ['rojo', 'roja', 'rojos', 'rojas'],
  amarillo: ['amarillo', 'amarilla'],
  morado: ['morado', 'morada', 'violeta', 'lila'],
  dorado: ['dorado', 'dorada'],
  plateado: ['plateado', 'plateada'],
  naranja: ['naranja', 'anaranjado'],
  beige: ['beige', 'crema', 'arena'],
  verde: ['verde', 'verdes'],
  azul: ['azul', 'azules'],
});
const CATEGORY_WORDS = vocabulary({
  ...Object.fromEntries(allCategoryValues().map((c) => [c, [plain(c.replace(/_/g, ' ')), `${plain(c.replace(/_/g, ' '))}s`]])),
  jeans: ['jeans', 'jean', 'vaqueros', 'bluyin', 'bluyines'],
  pantalon: ['pantalon', 'pantalones'],
  pantalon_vestir: ['pantalon de vestir', 'pantalon formal', 'pantalon de tela'],
  camiseta: ['camiseta', 'camisetas', 'playera', 'franela', 't-shirt', 'tshirt'],
  camisa: ['camisa', 'camisas'],
  sweater: ['sweater', 'sueter', 'saco de lana', 'buzo', 'jersey'],
  sudadera: ['sudadera', 'sudaderas'],
  hoodie: ['hoodie', 'capota', 'con capucha'],
  jogger: ['jogger', 'joggers', 'sudadera', 'pantalon de sudadera', 'pantalon deportivo', 'pants'],
  short: ['short', 'shorts', 'pantaloneta', 'bermuda', 'bermudas'],
  chaqueta: ['chaqueta', 'chaquetas', 'chamarra', 'campera'],
  blazer: ['blazer', 'saco', 'americana'],
  impermeable: ['impermeable', 'rompevientos'],
  tenis: ['tenis', 'zapatillas'],
  zapatos: ['zapatos', 'zapato', 'tacones', 'zapatos formales'],
  botas: ['botas', 'bota', 'botines'],
  sandalias: ['sandalias', 'sandalia', 'chanclas'],
  mocasines: ['mocasines', 'mocasin'],
  cinturon: ['cinturon', 'correa'],
  gafas: ['gafas', 'lentes de sol', 'gafas de sol'],
  bolso: ['bolso', 'cartera', 'bolsa'],
  mochila: ['mochila', 'morral', 'maleta'],
  joyeria: ['joyeria', 'collar', 'aretes', 'pulsera', 'anillo', 'cadena'],
  bufanda: ['bufanda', 'panoleta'],
  gorra: ['gorra', 'cachucha'],
});

const TYPE_WORDS = vocabulary({
  TOP: ['partes de arriba', 'parte de arriba', 'parte superior', 'tops'],
  BOTTOM: ['partes de abajo', 'parte de abajo', 'parte inferior'],
  FULL_BODY: ['prendas completas', 'vestidos y trajes'],
  OUTERWEAR: ['abrigos', 'chaquetas y abrigos', 'exterior'],
  FOOTWEAR: ['calzado', 'zapatos y tenis'],
  ACCESSORY: ['accesorios', 'accesorio'],
});

/** Words that carry no request of their own - never count as "something I didn't understand". */
const FILLER = new Set(
  ('un una unos unas el la los las lo de del al a para por en y o e que me mi mis te tu algo outfit look pinta ropa conjunto combinacion quiero necesito dame arma armame hazme ' +
    'haz busca buscame recomiendame recomienda sugiere sugiereme ponme vestirme vestir ir salir tengo hay hoy manana noche dia tarde esta este ese esa pero mas muy bien bonito bonita ' +
    'lindo linda con sin no nada ni tambien mejor uso usar usando llevar llevando pongo poner puesto puesta color tono tonos clima tipo estilo ocasion evento tenga lleve sea incluya uses').split(' '),
);

export interface ParsedRequest {
  context: OutfitContext;
  /** How many distinct things were understood (occasion, a color, a garment...). */
  understood: number;
  /** Meaningful words nothing here recognized. */
  leftover: string[];
}

/** Finds each vocabulary phrase in the text as whole words, consuming it so shorter ones don't re-match. */
function take(text: string, vocab: [string, string][]): { rest: string; found: { value: string; index: number; length: number }[] } {
  let rest = text;
  const found: { value: string; index: number; length: number }[] = [];
  for (const [phrase, value] of vocab) {
    const re = new RegExp(`(?<![a-z0-9])${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![a-z0-9])`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      found.push({ value, index: m.index, length: phrase.length });
      rest = `${rest.slice(0, m.index)}${'~'.repeat(phrase.length)}${rest.slice(m.index + phrase.length)}`;
    }
  }
  return { rest, found: found.sort((a, b) => a.index - b.index) };
}

/** True when the phrase at `index` is being ruled out: "sin corbata", "nada de negro", "no quiero tenis". */
function negated(text: string, index: number): boolean {
  return /(?:\bsin|\bnada de|\bno quiero|\bno me pongas|\bno uses|\bque no (?:sea|tenga|lleve|use|incluya)|\bevita(?:ndo)?|\bexcepto|\bni|\bmenos)(?: (?:el|la|los|las|un|una|mi|mis|de|color|ninguna|ningun))?\s*$/.test(
    text.slice(0, index),
  );
}

export function parseRequestLocally(rawText: string): ParsedRequest {
  const text = plain(rawText);
  const context: OutfitContext = {};
  let understood = 0;

  // Garments first (longest phrases: "pantalon de vestir" before "pantalon"), then colors - a
  // color right after a garment belongs to it ("blazer azul marino").
  const cats = take(text, CATEGORY_WORDS);
  const colors = take(cats.rest, COLOR_WORDS);
  let rest = colors.rest;

  const usedColors = new Set<number>();
  for (const cat of cats.found) {
    understood++;
    // the color is "this garment's" when nothing but connectors sits between them ("blazer de color azul")
    const end = cat.index + cat.length;
    const own = colors.found.find(
      (c) => !usedColors.has(c.index) && c.index >= end && text.slice(end, c.index).split(' ').every((w) => !w || ['de', 'del', 'color', 'en', 'tono'].includes(w)),
    );
    if (own) usedColors.add(own.index);
    if (negated(text, cat.index)) {
      // "que no tenga camiseta blanca": that part of the body must not be that color - any white
      // top is out, not every t-shirt. Without a color, the kind of garment itself is out.
      if (own) context.avoid = [...(context.avoid ?? []), { role: typeForCategory(cat.value), color: own.value }];
      else context.excludeCategories = [...new Set([...(context.excludeCategories ?? []), cat.value])];
      continue;
    }
    context.mustHave = [...(context.mustHave ?? []), { category: cat.value, ...(own ? { color: own.value } : {}) }];
  }
  for (const color of colors.found) {
    if (usedColors.has(color.index)) continue;
    understood++;
    if (negated(text, color.index)) context.colorsAvoided = [...new Set([...(context.colorsAvoided ?? []), color.value])];
    else context.colorsPreferred = [...new Set([...(context.colorsPreferred ?? []), color.value])];
  }

  const single = (vocab: [string, string][], key: 'occasion' | 'formality' | 'weather' | 'style') => {
    const taken = take(rest, vocab);
    rest = taken.rest;
    const hit = taken.found.find((f) => !negated(text, f.index));
    if (hit) {
      context[key] = hit.value;
      understood++;
    }
  };
  single(FORMALITY_WORDS, 'formality');
  single(OCCASION_WORDS, 'occasion');
  single(WEATHER_WORDS, 'weather');
  single(STYLE_WORDS, 'style');

  const leftover = rest
    .replace(/~+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !FILLER.has(w) && !/^\d+$/.test(w));
  return { context, understood, leftover };
}

/**
 * Adds a follow-up ("sin blazer", "con tenis", "más formal", "en vez de jeans un chino") onto the
 * request already being worked on: new musts and exclusions pile up, a garment newly excluded
 * stops being a must (and the other way round), and a new occasion/formality/weather/style
 * replaces the old one.
 */
export function refineContext(base: OutfitContext, change: OutfitContext): OutfitContext {
  const merged: OutfitContext = { ...base };
  for (const key of ['occasion', 'formality', 'weather', 'style', 'season'] as const) if (change[key]) merged[key] = change[key];

  const exclude = new Set([...(base.excludeCategories ?? []), ...(change.excludeCategories ?? [])]);
  const must = [...(base.mustHave ?? [])];
  for (const m of change.mustHave ?? []) {
    exclude.delete(m.category);
    // one top, one bottom, one pair of shoes...: naming another takes the earlier one's place
    // (accessories can pile up)
    const role = typeForCategory(m.category);
    const at = must.findIndex((x) => x.category === m.category || (role !== 'ACCESSORY' && typeForCategory(x.category) === role));
    if (at >= 0) must[at] = m;
    else must.push(m);
  }
  merged.mustHave = must.filter((m) => !exclude.has(m.category));
  merged.excludeCategories = [...exclude];

  // a rule asked for again replaces itself; a garment now asked for in that color lifts its rule
  const avoidKey = (r: { role?: string; category?: string; color?: string }) => `${r.role ?? ''}|${r.category ?? ''}|${r.color ?? ''}`;
  const avoid = new Map([...(base.avoid ?? []), ...(change.avoid ?? [])].map((r) => [avoidKey(r), r]));
  for (const m of change.mustHave ?? []) {
    for (const [key, rule] of avoid) if (rule.color && rule.color === m.color && (!rule.role || rule.role === typeForCategory(m.category))) avoid.delete(key);
  }
  merged.avoid = [...avoid.values()];
  merged.requiredGarmentIds = [...new Set([...(base.requiredGarmentIds ?? []), ...(change.requiredGarmentIds ?? [])])];
  merged.excludeGarmentIds = [...new Set([...(base.excludeGarmentIds ?? []), ...(change.excludeGarmentIds ?? [])])].filter(
    (id) => !merged.requiredGarmentIds!.includes(id),
  );

  const avoided = new Set([...(base.colorsAvoided ?? []), ...(change.colorsAvoided ?? [])]);
  const preferred = new Set(change.colorsPreferred?.length ? change.colorsPreferred : (base.colorsPreferred ?? []));
  for (const c of change.colorsPreferred ?? []) avoided.delete(c);
  for (const c of avoided) preferred.delete(c);
  merged.colorsAvoided = [...avoided];
  merged.colorsPreferred = [...preferred];

  // an explicit garment the request named is kept; empty lists are dropped so the request reads clean
  for (const key of ['mustHave', 'excludeCategories', 'avoid', 'requiredGarmentIds', 'excludeGarmentIds', 'colorsAvoided', 'colorsPreferred'] as const) {
    if (!merged[key]?.length) delete merged[key];
  }
  return merged;
}

export { plain as plainText, CATEGORY_WORDS, COLOR_WORDS, TYPE_WORDS, take as takeWords };
