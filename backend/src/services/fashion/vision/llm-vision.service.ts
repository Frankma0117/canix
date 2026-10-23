import { env } from '../../../config/env.js';
import { aiUsageModel } from '../../../models/ai-usage.model.js';
import {
  GARMENT_TYPES,
  CATEGORIES_BY_TYPE,
  COLORS,
  PATTERNS,
  MATERIALS,
  FITS,
  NECKLINES,
  SLEEVES,
  LENGTHS,
  CLOSURES,
  POCKETS,
  STYLES,
  FORMALITY,
  SEASONS,
  WEATHER,
  OCCASIONS,
  WARMTH,
  WATER_RESISTANCE,
  GENDERS,
  OBSERVED_FIELDS,
  allCategoryValues,
  confidenceTier,
  normalizeToTaxonomy,
  typeForCategory,
} from '../taxonomy.js';
import type { FieldMeta, VisionAnalysisResult } from './vision.service.js';

/**
 * Garment classification by a vision LLM that actually LOOKS at the photo and reasons about it
 * (through fal.ai's any-llm endpoint, with the key the project already has), instead of the local
 * CLIP similarity match - which filed a whole wardrobe's pants as tops. It still can't invent
 * anything: every value it returns is checked against taxonomy.ts and dropped if it isn't there.
 *
 * What it isn't sure about comes back as `doubts` - detailed questions for the person, answered
 * from the web portal (see services/fashion/review.ts) - rather than as a silent guess.
 */

/** Every single-value field and the pool its value has to come from. */
export const FIELD_POOLS: Record<string, readonly string[]> = {
  type: GARMENT_TYPES,
  category: allCategoryValues(),
  color: COLORS,
  pattern: PATTERNS,
  material: MATERIALS,
  fit: FITS,
  formality: FORMALITY,
  warmth: WARMTH,
  waterResistance: WATER_RESISTANCE,
  neckline: NECKLINES,
  sleeves: SLEEVES,
  length: LENGTHS,
  closure: CLOSURES,
  pockets: POCKETS,
  gender: GENDERS,
};

/** Every list field and its pool. */
export const LIST_POOLS: Record<string, readonly string[]> = {
  secondaryColors: COLORS,
  style: STYLES,
  season: SEASONS,
  weather: WEATHER,
  occasions: OCCASIONS,
};

/** The names the model is asked to answer with (Spanish, like the rest of its prompt) -> our fields. */
const KEYS: Record<string, string> = {
  tipo: 'type',
  categoria: 'category',
  color: 'color',
  colores_secundarios: 'secondaryColors',
  patron: 'pattern',
  material: 'material',
  ajuste: 'fit',
  estilo: 'style',
  formalidad: 'formality',
  temporada: 'season',
  clima: 'weather',
  ocasiones: 'occasions',
  abrigo: 'warmth',
  agua: 'waterResistance',
  cuello: 'neckline',
  mangas: 'sleeves',
  largo: 'length',
  cierre: 'closure',
  bolsillos: 'pockets',
  genero: 'gender',
};

export interface GarmentDoubt {
  /** One of FIELD_POOLS' keys, or 'is_garment' when the photo doesn't seem to be a garment at all. */
  field: string;
  question: string;
  /** Taxonomy values worth offering first; the portal still lets any value of the field be picked. */
  options: string[];
  suggested: string | null;
}

export interface LlmGarmentAnalysis extends VisionAnalysisResult {
  isGarment: boolean;
  /** What the model says it sees, in its own words - shown next to the questions. */
  seen: string | null;
  subcategory: string | null;
  gender: string | null;
  season: string[];
  weather: string[];
  occasions: string[];
  brand: string | null;
  doubts: GarmentDoubt[];
}

const list = (values: readonly string[]) => values.join(' | ');

function buildPrompt(): string {
  const categories = GARMENT_TYPES.map((t) => `  ${t}: ${CATEGORIES_BY_TYPE[t].map((c) => c.value).join(', ')}`).join('\n');
  return `Eres un experto en moda que cataloga el armario de una persona en Colombia. Mira la foto y clasifica LA PRENDA PRINCIPAL (la que ocupa el centro o la mayor parte). Fíjate bien en la forma: una prenda con dos piernas es de la parte inferior aunque esté doblada; una con mangas y cuello es superior.

Responde SOLO un objeto JSON, sin texto alrededor, con estas claves. Usa EXACTAMENTE los valores permitidos (o null si no aplica o no se puede saber):

"es_prenda": true/false (false si la foto no es ropa, calzado ni un accesorio)
"varias_prendas": true/false (true si hay varias prendas distintas y no es claro cuál es la principal)
"descripcion": una frase concreta de lo que ves (forma, color, detalles, cómo está puesta la prenda)
"tipo": ${list(GARMENT_TYPES)}
"categoria": según el tipo:
${categories}
"subcategoria": texto libre corto y específico (ej. "jogger", "camisa oxford", "bomber", "tenis de running") o null
"color": color principal: ${list(COLORS)}
"colores_secundarios": lista (puede ir vacía) de esos mismos colores
"patron": ${list(PATTERNS)}
"material": ${list(MATERIALS)}
"ajuste": ${list(FITS)}
"estilo": lista de 1 a 3 entre: ${list(STYLES)}
"formalidad": ${list(FORMALITY)}
"temporada": lista entre: ${list(SEASONS)}
"clima": lista entre: ${list(WEATHER)}
"ocasiones": lista de las ocasiones para las que sirve: ${list(OCCASIONS)}
"abrigo": ${list(WARMTH)}
"agua": ${list(WATER_RESISTANCE)}
"cuello": ${list(NECKLINES)} (solo prendas superiores, de cuerpo completo o abrigos; si no, null)
"mangas": ${list(SLEEVES)} (igual que cuello)
"largo": ${list(LENGTHS)} (solo inferiores, cuerpo completo o abrigos; si no, null)
"cierre": ${list(CLOSURES)}
"bolsillos": ${list(POCKETS)}
"genero": ${list(GENDERS)}
"marca": la marca SOLO si se lee un logo o etiqueta en la foto; si no, null
"confianza": objeto con un número de 0 a 1 por cada clave anterior que llenaste (tipo, categoria, color, patron, material, ajuste, formalidad, etc.). Sé honesto: 0.95 solo si se ve clarísimo; el material casi nunca se puede asegurar por foto.
"dudas": lista (vacía si no hay) de lo que NO puedes determinar con seguridad y la persona sí sabría. Cada una: {"campo": una de las claves de arriba, "pregunta": pregunta detallada en español contando qué ves y por qué dudas, "opciones": 2 a 5 valores permitidos de ese campo entre los que dudas}

Notas: "sudadera" en categoría es el buzo de la parte superior; un pantalón deportivo o de sudadera es "jogger". "tenis" es calzado deportivo; "sneakers" son tenis de uso casual/urbano. No inventes valores fuera de las listas.`;
}

let cachedPrompt: string | undefined;

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);

/** A value of the model's, only if it's really one of the field's allowed values. */
function allowed(pool: readonly string[], value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const exact = pool.find((p) => p.toLowerCase() === text.toLowerCase());
  return exact ?? normalizeToTaxonomy(pool, text) ?? null;
}

function allowedList(pool: readonly string[], value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => allowed(pool, v)).filter((v): v is string => !!v))];
}

function confidenceOf(raw: unknown, key: string): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = Number((raw as Record<string, unknown>)[key]);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : undefined;
}

/** Turns the model's answer into a checked analysis. Exported for tests; `raw` is its parsed JSON. */
function readAnalysis(raw: Record<string, unknown>, modelName: string): LlmGarmentAnalysis {
  const single: Record<string, string | null> = {};
  const fieldMeta: Record<string, FieldMeta> = {};
  for (const [key, field] of Object.entries(KEYS)) {
    const pool = FIELD_POOLS[field];
    if (!pool) continue;
    single[field] = allowed(pool, raw[key]);
    const confidence = confidenceOf(raw.confianza, key);
    if (single[field] && confidence !== undefined) {
      fieldMeta[field] = { confidence, tier: confidenceTier(confidence), certainty: OBSERVED_FIELDS.has(field) ? 'observado' : 'inferido' };
    }
  }

  // Sweatpants are their own thing in this wardrobe, however the model filed them.
  const detail = str(raw.subcategoria)?.toLowerCase() ?? '';
  if (single.category === 'pantalon' && /jogger|sudadera|deportiv|ch[aá]ndal|track/.test(detail)) single.category = 'jogger';

  // The category decides the type: it's the more specific of the two, and a "jeans" filed under TOP
  // is exactly the kind of mistake this replaces.
  if (single.category) single.type = typeForCategory(single.category) ?? single.type;
  if (single.type && single.category && typeForCategory(single.category) !== single.type) single.category = null;

  const isGarment = raw.es_prenda !== false;
  const doubts: GarmentDoubt[] = [];
  if (Array.isArray(raw.dudas)) {
    for (const d of raw.dudas as Record<string, unknown>[]) {
      const field = KEYS[String(d?.campo ?? '')];
      const pool = field ? FIELD_POOLS[field] ?? LIST_POOLS[field] : undefined;
      const question = str(d?.pregunta);
      if (!field || !pool || !question || field === 'gender' || doubts.some((x) => x.field === field)) continue;
      doubts.push({ field, question, options: allowedList(pool, d.opciones), suggested: single[field] ?? null });
    }
  }

  return {
    isGarment,
    seen: str(raw.descripcion),
    type: single.type,
    category: single.category,
    subcategory: str(raw.subcategoria),
    color: single.color,
    secondaryColors: allowedList(COLORS, raw.colores_secundarios).filter((c) => c !== single.color),
    pattern: single.pattern,
    style: allowedList(STYLES, raw.estilo),
    formality: single.formality,
    fit: single.fit,
    material: single.material,
    warmth: single.warmth,
    waterResistance: single.waterResistance,
    neckline: single.neckline,
    sleeves: single.sleeves,
    closure: single.closure,
    pockets: single.pockets,
    length: single.length,
    gender: single.gender,
    season: allowedList(SEASONS, raw.temporada),
    weather: allowedList(WEATHER, raw.clima),
    occasions: allowedList(OCCASIONS, raw.ocasiones),
    brand: str(raw.marca),
    fieldMeta,
    qualityIssues: [],
    modelName,
    doubts,
    raw: { ...raw, varias_prendas: raw.varias_prendas === true },
  };
}

export const llmVision = {
  /** Off without a fal.ai key - everything then works as before, on the local classifier alone. */
  enabled(): boolean {
    return !!env.fal.apiKey && env.fashion.llmVision.enabled;
  },

  /** The name stored in garments.analysis_model for what this classified. */
  modelName(): string {
    return `fal:${env.fashion.llmVision.model}`;
  },

  /** Classifies the garment in a publicly reachable photo. Null (never throws) when it couldn't. */
  async analyze(imageUrl: string, userId: number): Promise<LlmGarmentAnalysis | null> {
    if (!this.enabled()) return null;
    const { endpoint, model, timeoutMs } = env.fashion.llmVision;
    cachedPrompt ??= buildPrompt();
    try {
      const res = await fetch(`https://fal.run/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Key ${env.fal.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: cachedPrompt, image_url: imageUrl, model }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        console.error('[FASHION] Vision (LLM) answered %d: %s', res.status, (await res.text()).slice(0, 200));
        return null;
      }
      const body = (await res.json()) as { output?: string };
      const raw = parseJson(body.output ?? '');
      if (!raw) {
        console.error('[FASHION] Vision (LLM) did not return JSON: %s', (body.output ?? '').slice(0, 200));
        return null;
      }
      // fal bills per call here and reports no token counts: characters are logged as the measure.
      aiUsageModel.log(userId, 'fashion_vision', this.modelName(), cachedPrompt.length, (body.output ?? '').length);
      return readAnalysis(raw, this.modelName());
    } catch (err) {
      console.error('[FASHION] Vision (LLM) failed:', (err as Error).message);
      return null;
    }
  },
};
