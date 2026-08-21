import type { TaxonomyCandidates, ConfidenceTier } from '../taxonomy.js';

/** Per-field metadata attached alongside every detected value - see taxonomy.ts's confidenceTier()/
 *  OBSERVED_FIELDS for how tier/certainty are computed. Lets the confirmation screen and the stored
 *  garment show "esto lo veo clarísimo" vs "esto es una estimación" instead of presenting every
 *  field with the same flat confidence, per the user's explicit "no mezcles observación e
 *  inferencia" requirement. */
export interface FieldMeta {
  confidence: number;
  tier: ConfidenceTier;
  certainty: 'observado' | 'inferido';
}

export interface VisionAnalysisResult {
  type: string | null;
  category: string | null;
  color: string | null;
  secondaryColors: string[];
  pattern: string | null;
  style: string[];
  formality: string | null;
  fit: string | null;
  material: string | null;
  warmth: string | null;
  waterResistance: string | null;
  // Type-conditional fields (see taxonomy.ts's candidateLabelsForVisionPass2) - null when this
  // garment's type doesn't make the question meaningful (e.g. neckline on a pair of shoes), not
  // when the model just couldn't tell - those two cases are otherwise indistinguishable from a bare
  // null, which is exactly why they're only ever REQUESTED for applicable types in the first place.
  neckline: string | null;
  sleeves: string | null;
  closure: string | null;
  pockets: string | null;
  length: string | null;
  /** Every field that made it above the confidence floor, keyed by the SAME field names as above
   *  (camelCase) - the confirmation screen and garments.repo.ts's analysis_confidence column both
   *  read this directly instead of re-deriving it. */
  fieldMeta: Record<string, FieldMeta>;
  /** Photo quality problems detected BEFORE classification even ran (see vision-service/quality.py)
   *  - 'blurry' | 'too_dark' | 'too_bright' | 'too_small'. Empty when the photo looked fine.
   *  Classification still runs either way (a flagged photo often still yields a usable, just
   *  lower-confidence, result) - this is surfaced so the caller can give a specific, helpful
   *  message ("la foto está borrosa, ¿me mandas otra más cercana?") instead of a generic
   *  "no pude analizarla" when confidence ends up low. */
  qualityIssues: string[];
  /** Whichever CLIP model actually produced this analysis (see vision-service/model.py's
   *  current_model_name) - stored per-garment as `analysis_model` so a future audit or "actualizar
   *  ropa" run can tell which model/version classified what, instead of it being anonymous. */
  modelName: string | null;
  /** The raw microservice response (both passes), stored verbatim into garments.ai_metadata for audit/debug. */
  raw: unknown;
}

/**
 * Abstracts "how a garment photo gets analyzed" behind a swappable interface, exactly so the
 * implementation can change later (local model, a different local model, or eventually a paid API
 * if the user ever wants one) without touching any of the add-garment flow. The only
 * implementation today is HttpVisionService, calling a local Python microservice - see
 * /vision-service. Returning `null` (not throwing) is the contract for "couldn't analyze it",
 * which the flow treats as "fall back to asking the user manually" - vision failing must never
 * crash or block adding a garment. Takes no taxonomy parameter (unlike the old single-pass design) -
 * the implementation now decides its own candidate groups per pass internally (see taxonomy.ts's
 * candidateLabelsForVisionPass1/2), since pass 2's candidates depend on pass 1's own result.
 */
export interface VisionService {
  analyze(imageBuffer: Buffer): Promise<VisionAnalysisResult | null>;
}

/** Re-exported so callers that only need the taxonomy shape (not the service itself) don't have to
 *  reach into taxonomy.ts directly - kept for the rare case something imports just the type. */
export type { TaxonomyCandidates };
