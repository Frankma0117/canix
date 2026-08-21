/**
 * Controlled taxonomy for Fashion Mode - deliberately plain TS const arrays (no DB lookup table,
 * no SQLite CHECK constraint on `garments`), matching how this codebase already represents its
 * other closed value sets (TodoScope/RecurrenceFreq/MealSlot/ReminderKind in types/index.ts).
 * Adding a new category later is a one-line array edit + redeploy, not a schema migration - a
 * CHECK constraint would need the same rename/recreate/copy/drop dance db/init.ts's
 * migrateToMultiUser() already had to do for categories/contacts (see that function's comment).
 *
 * This is also the anti-hallucination mechanism: the vision microservice is only ever given the
 * label lists below as candidates and picks one by embedding similarity - it can never invent a
 * category outside this file. See candidateLabelsForVision() below.
 */

export const GARMENT_TYPES = ['TOP', 'BOTTOM', 'FULL_BODY', 'OUTERWEAR', 'FOOTWEAR', 'ACCESSORY'] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

interface CategoryOption {
  value: string;
  label: string;
}

export const CATEGORIES_BY_TYPE: Record<GarmentType, CategoryOption[]> = {
  TOP: [
    { value: 'camiseta', label: 'Camiseta' },
    { value: 'camisa', label: 'Camisa' },
    { value: 'polo', label: 'Polo' },
    { value: 'blusa', label: 'Blusa' },
    { value: 'top', label: 'Top' },
    { value: 'sweater', label: 'Sweater' },
    { value: 'sudadera', label: 'Sudadera' },
    { value: 'hoodie', label: 'Hoodie' },
    { value: 'chaleco', label: 'Chaleco' },
  ],
  BOTTOM: [
    { value: 'jeans', label: 'Jeans' },
    { value: 'pantalon', label: 'Pantalón' },
    { value: 'chino', label: 'Chino' },
    { value: 'pantalon_vestir', label: 'Pantalón de vestir' },
    { value: 'short', label: 'Short' },
    { value: 'falda', label: 'Falda' },
  ],
  FULL_BODY: [
    { value: 'vestido', label: 'Vestido' },
    { value: 'enterizo', label: 'Enterizo' },
    { value: 'traje', label: 'Traje' },
  ],
  OUTERWEAR: [
    { value: 'chaqueta', label: 'Chaqueta' },
    { value: 'blazer', label: 'Blazer' },
    { value: 'abrigo', label: 'Abrigo' },
    { value: 'impermeable', label: 'Impermeable' },
    { value: 'gabardina', label: 'Gabardina' },
  ],
  FOOTWEAR: [
    { value: 'tenis', label: 'Tenis' },
    { value: 'sneakers', label: 'Sneakers' },
    { value: 'zapatos', label: 'Zapatos' },
    { value: 'botas', label: 'Botas' },
    { value: 'sandalias', label: 'Sandalias' },
    { value: 'mocasines', label: 'Mocasines' },
  ],
  ACCESSORY: [
    { value: 'reloj', label: 'Reloj' },
    { value: 'cinturon', label: 'Cinturón' },
    { value: 'gorra', label: 'Gorra' },
    { value: 'sombrero', label: 'Sombrero' },
    { value: 'gafas', label: 'Gafas' },
    { value: 'bolso', label: 'Bolso' },
    { value: 'mochila', label: 'Mochila' },
    { value: 'corbata', label: 'Corbata' },
    { value: 'bufanda', label: 'Bufanda' },
    { value: 'joyeria', label: 'Joyería' },
    { value: 'otros', label: 'Otros' },
  ],
};

export const GARMENT_TYPE_LABELS: Record<GarmentType, string> = {
  TOP: 'Parte superior',
  BOTTOM: 'Parte inferior',
  FULL_BODY: 'Prenda completa',
  OUTERWEAR: 'Exterior/abrigo',
  FOOTWEAR: 'Calzado',
  ACCESSORY: 'Accesorio',
};

export const COLORS = [
  'blanco', 'negro', 'gris', 'beige', 'café', 'azul', 'azul_claro', 'azul_marino', 'verde',
  'verde_oliva', 'rojo', 'vino', 'rosado', 'morado', 'amarillo', 'naranja', 'dorado', 'plateado',
  'multicolor',
] as const;

export const PATTERNS = ['liso', 'rayas', 'cuadros', 'estampado', 'floral', 'animal_print', 'a_lunares'] as const;
export const MATERIALS = ['algodon', 'lino', 'lana', 'poliester', 'denim', 'cuero', 'seda', 'sintetico', 'mezcla'] as const;
// Ampliado con más matices de silueta (slim/oversized/boxy/cropped/recta/tapered/ancha) en vez de
// crear un campo "silhouette" aparte - son el mismo concepto (qué tan ceñida/holgada cae la prenda),
// y separarlos hubiera sido un campo duplicado y confuso en vez de uno más rico.
export const FITS = ['ajustado', 'slim', 'regular', 'holgado', 'oversize', 'boxy', 'cropped', 'recto', 'tapered', 'ancho'] as const;
// Solo aplica a TOP/OUTERWEAR/FULL_BODY (ver garmentTypesForGroup abajo) - no tiene sentido
// preguntarle al modelo por el cuello de un pantalón.
export const NECKLINES = [
  'cuello_redondo', 'cuello_v', 'cuello_polo', 'cuello_mao', 'cuello_italiano', 'cuello_cutaway',
  'button_down', 'cuello_alto', 'halter', 'cuello_cuadrado', 'cuello_barco', 'sin_cuello',
] as const;
export const SLEEVES = ['sin_mangas', 'manga_corta', 'manga_3_4', 'manga_larga', 'manga_abullonada', 'raglan'] as const;
// Un solo pool compartido entre BOTTOM/FULL_BODY/OUTERWEAR - el modelo elige el término que mejor
// aplique según lo que ya sabe (falda/vestido/abrigo), no es 100% preciso pero evita triplicar la
// taxonomía por tipo de prenda para una diferencia menor.
export const LENGTHS = ['cropped', 'cintura', 'cadera', 'muslo', 'rodilla', 'midi', 'maxi'] as const;
export const CLOSURES = ['botones', 'cremallera', 'broches', 'cordones', 'cruzado', 'sin_cierre_visible'] as const;
export const POCKETS = ['sin_bolsillos_visibles', 'bolsillos_pecho', 'bolsillos_laterales', 'bolsillos_cargo', 'bolsillos_traseros', 'bolsillos_ocultos'] as const;
export const STYLES = ['casual', 'smart_casual', 'formal', 'deportivo', 'urbano', 'clasico', 'minimalista', 'bohemio'] as const;
export const FORMALITY = ['muy_informal', 'informal', 'smart_casual', 'formal', 'muy_formal'] as const;
export const SEASONS = ['primavera', 'verano', 'otono', 'invierno', 'todo_el_ano'] as const;
export const WEATHER = ['calido', 'templado', 'frio', 'lluvia'] as const;
export const OCCASIONS = [
  'oficina', 'casual', 'entrevista', 'boda', 'cita', 'cena', 'fiesta', 'viaje', 'gimnasio', 'playa',
  'evento_formal', 'evento_semi_formal',
] as const;
export const CONDITIONS = ['nuevo', 'buen_estado', 'usado', 'desgastado'] as const;
export const WARMTH = ['ligero', 'medio', 'abrigado'] as const;
export const WATER_RESISTANCE = ['no', 'resistente', 'impermeable'] as const;
export const GENDERS = ['hombre', 'mujer', 'unisex'] as const;
export const SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'unica'] as const;
// A person's general build (not a garment's) - used by the outfit engine to reason about fit
// alongside a garment's own `fit` (ajustado/holgado/etc), see fashion-profile.repo.ts /
// set-fashion-profile.tool.ts. Deliberately coarse (4 buckets) - this is a styling input, not a
// medical/precise measurement.
export const BODY_BUILDS = ['delgada', 'media', 'robusta', 'atletica'] as const;

/** All category `value`s across every type, flattened - used to validate/search without caring
 *  which type a given category belongs to. */
export function allCategoryValues(): string[] {
  return Object.values(CATEGORIES_BY_TYPE).flatMap((cats) => cats.map((c) => c.value));
}

export function typeForCategory(category: string): GarmentType | undefined {
  const norm = category.toLowerCase().trim();
  for (const type of GARMENT_TYPES) {
    if (CATEGORIES_BY_TYPE[type].some((c) => c.value === norm)) return type;
  }
  return undefined;
}

export function isValidCategory(category: string): boolean {
  return typeForCategory(category) !== undefined;
}

/** Loose match for free-text filters ("armario camisas", "cambiar categoría a jean") - strips
 *  accents/plurals and matches against value or label, never invents a category that isn't here. */
export function normalizeToTaxonomy(pool: readonly string[], freeText: string): string | undefined {
  const norm = freeText
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/s$/, ''); // crude singularization ("camisas" -> "camisa")
  return pool.find((v) => {
    const pv = v
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ');
    return pv === norm || pv.replace(/s$/, '') === norm || pv === `${norm}s`;
  });
}

export function normalizeCategory(freeText: string): string | undefined {
  return normalizeToTaxonomy(allCategoryValues(), freeText);
}

export function normalizeColor(freeText: string): string | undefined {
  return normalizeToTaxonomy(COLORS, freeText);
}

export function normalizeOccasion(freeText: string): string | undefined {
  return normalizeToTaxonomy(OCCASIONS, freeText);
}

export function normalizeSeason(freeText: string): string | undefined {
  return normalizeToTaxonomy(SEASONS, freeText);
}

export function normalizeWeather(freeText: string): string | undefined {
  return normalizeToTaxonomy(WEATHER, freeText);
}

/** Ordered muy_informal(0) .. muy_formal(4) - lets the outfit engine compare "how close" a
 *  garment's formality is to what was requested (see fashion/outfit/rules.ts) without hardcoding
 *  the order a second time anywhere else. */
export function formalityIndex(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const idx = FORMALITY.indexOf(value as (typeof FORMALITY)[number]);
  return idx === -1 ? undefined : idx;
}

/** Grouped candidate labels sent to the vision microservice on every /analyze call - the single
 *  source of truth for the taxonomy lives here, never duplicated into the Python side, so they
 *  can't drift out of sync. */
export interface TaxonomyCandidates {
  groups: { group: string; values: string[] }[];
}

/**
 * Bumped whenever the taxonomy/pipeline changes in a way that could change what a photo gets
 * classified as (new groups, reworded candidates, restructured passes) - stored per-garment as
 * `analysis_version` (see garments.repo.ts) so "actualizar ropa" and any future audit can tell
 * which pass produced which data instead of guessing. Plain integer, bump by 1 per meaningful change.
 */
export const ANALYSIS_VERSION = 2;

/**
 * PASS 1 of garment vision analysis - type-independent groups only. `category` is deliberately
 * NOT here: asking the model to pick among all ~45 categories across every garment type at once
 * (the old single-pass design) meant a lot of irrelevant competition for every photo - a shirt only
 * ever needed to compete against other TOP categories, not against "falda"/"botas"/"cinturon" too.
 * See candidateLabelsForVisionPass2 below, which only runs once `type` is known from this pass.
 */
export function candidateLabelsForVisionPass1(): TaxonomyCandidates {
  return {
    groups: [
      { group: 'type', values: [...GARMENT_TYPES] },
      { group: 'pattern', values: [...PATTERNS] },
      { group: 'style', values: [...STYLES] },
      { group: 'formality', values: [...FORMALITY] },
    ],
  };
}

/** Which of the type-conditional pass-2 attribute groups make sense for a given garment type -
 *  e.g. asking about "cuello"/"mangas" on a pair of shoes would just add noise, never a real
 *  answer. Kept as one small lookup instead of scattering `if (type === ...)` checks. */
const NECKLINE_SLEEVES_TYPES: readonly GarmentType[] = ['TOP', 'OUTERWEAR', 'FULL_BODY'];
const CLOSURE_POCKETS_TYPES: readonly GarmentType[] = ['TOP', 'OUTERWEAR', 'BOTTOM', 'FULL_BODY'];
const LENGTH_TYPES: readonly GarmentType[] = ['BOTTOM', 'FULL_BODY', 'OUTERWEAR'];

/**
 * PASS 2 - runs only once pass 1 confidently identified `type`. `category` is scoped to exactly
 * that type's own options (CATEGORIES_BY_TYPE[type]), which is the single biggest accuracy win in
 * this whole taxonomy: the model now only ever has to tell a "camisa" from a "polo" from a
 * "sweater", never from "falda" or "botas" at the same time. The rest (fit/material/warmth/
 * water_resistance) always apply; neckline/sleeves/closure/pockets/length only join in when they're
 * actually meaningful for this type (see the lookups above).
 */
export function candidateLabelsForVisionPass2(type: GarmentType): TaxonomyCandidates {
  const groups: { group: string; values: string[] }[] = [
    { group: 'category', values: CATEGORIES_BY_TYPE[type].map((c) => c.value) },
    { group: 'fit', values: [...FITS] },
    { group: 'material', values: [...MATERIALS] },
    { group: 'warmth', values: [...WARMTH] },
    { group: 'water_resistance', values: [...WATER_RESISTANCE] },
  ];
  if (NECKLINE_SLEEVES_TYPES.includes(type)) {
    groups.push({ group: 'neckline', values: [...NECKLINES] }, { group: 'sleeves', values: [...SLEEVES] });
  }
  if (CLOSURE_POCKETS_TYPES.includes(type)) {
    groups.push({ group: 'closure', values: [...CLOSURES] }, { group: 'pockets', values: [...POCKETS] });
  }
  if (LENGTH_TYPES.includes(type)) {
    groups.push({ group: 'length', values: [...LENGTHS] });
  }
  return { groups };
}

/** Confidence tiers per the user's own spec: >=0.90 alta, >=0.70 media, >=0.40 baja, below that
 *  treated as desconocido (the caller drops the value entirely rather than storing a low-confidence
 *  guess - see http-vision.service.ts's `pick()`). */
export type ConfidenceTier = 'alta' | 'media' | 'baja';

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.9) return 'alta';
  if (confidence >= 0.7) return 'media';
  return 'baja';
}

/**
 * Whether a field counts as directly OBSERVED vs. ESTIMATED (inferred) - a fixed, honest mapping,
 * not something the model itself decides (CLIP has no reasoning trace to introspect - it's a
 * similarity comparison, not a model that can explain "I can see X therefore Y"). Color/pattern/
 * neckline/sleeves/closure/pockets/length are structural/visual traits closest to "directly on the
 * surface of the photo"; material/fit/warmth/water_resistance/style/formality are judgment calls
 * even when the model is confident about them, so they're always "inferido", never "observado" -
 * see BASE fields comment in vision.service.ts for where this gets attached per result.
 */
export const OBSERVED_FIELDS = new Set([
  'type',
  'category',
  'color',
  'secondaryColors',
  'pattern',
  'neckline',
  'sleeves',
  'closure',
  'pockets',
  'length',
]);
