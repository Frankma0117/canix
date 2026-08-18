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
export const FITS = ['ajustado', 'regular', 'holgado', 'oversize'] as const;
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

export function candidateLabelsForVision(): TaxonomyCandidates {
  return {
    groups: [
      { group: 'type', values: [...GARMENT_TYPES] },
      { group: 'category', values: allCategoryValues() },
      { group: 'color', values: [...COLORS] },
      { group: 'pattern', values: [...PATTERNS] },
      { group: 'style', values: [...STYLES] },
      { group: 'formality', values: [...FORMALITY] },
    ],
  };
}
