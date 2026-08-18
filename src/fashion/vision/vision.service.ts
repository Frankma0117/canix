import type { TaxonomyCandidates } from '../taxonomy.js';

export interface VisionAnalysisResult {
  type: string | null;
  category: string | null;
  color: string | null;
  secondaryColors: string[];
  pattern: string | null;
  style: string[];
  formality: string | null;
  confidence: Record<string, number>;
  /** The raw microservice response, stored verbatim into garments.ai_metadata for audit/debug. */
  raw: unknown;
}

/**
 * Abstracts "how a garment photo gets analyzed" behind a swappable interface, exactly so the
 * implementation can change later (local model, a different local model, or eventually a paid API
 * if the user ever wants one) without touching any of the add-garment flow. The only
 * implementation today is HttpVisionService, calling a local Python microservice - see
 * /vision-service. Returning `null` (not throwing) is the contract for "couldn't analyze it",
 * which the flow treats as "fall back to asking the user manually" - vision failing must never
 * crash or block adding a garment.
 */
export interface VisionService {
  analyze(imageBuffer: Buffer, taxonomy: TaxonomyCandidates): Promise<VisionAnalysisResult | null>;
}
