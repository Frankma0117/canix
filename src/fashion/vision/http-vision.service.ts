import { env } from '../../config/env.js';
import {
  candidateLabelsForVisionPass1,
  candidateLabelsForVisionPass2,
  confidenceTier,
  OBSERVED_FIELDS,
  GARMENT_TYPES,
  typeForCategory,
  type TaxonomyCandidates,
  type GarmentType,
} from '../taxonomy.js';
import type { VisionService, VisionAnalysisResult, FieldMeta } from './vision.service.js';

interface ScoredValue {
  value: string;
  confidence: number;
}

interface AnalyzeResponse {
  quality?: { ok: boolean; issues: string[] };
  model?: string | null;
  type?: ScoredValue;
  category?: ScoredValue;
  color?: ScoredValue;
  secondary_color?: ScoredValue;
  pattern?: ScoredValue;
  style?: ScoredValue[];
  formality?: ScoredValue;
  fit?: ScoredValue;
  material?: ScoredValue;
  warmth?: ScoredValue;
  water_resistance?: ScoredValue;
  neckline?: ScoredValue;
  sleeves?: ScoredValue;
  closure?: ScoredValue;
  pockets?: ScoredValue;
  length?: ScoredValue;
}

export interface PdfExtractResult {
  images: Buffer[];
  /** Count found in the PDF BEFORE the max-images cap - lets the caller tell the user "found N,
   *  processed the first M" when the PDF had more photos than the cap allows. */
  totalFound: number;
}

/**
 * Calls the local Python microservice (see /vision-service) that does the actual garment image
 * analysis via a CLIP-family zero-shot model - free, self-hosted, no external API cost (see the
 * user's explicit requirement, and README's "Fashion Mode" section for setup). Every failure mode
 * (service not running, timeout, malformed response) is caught here and turned into `null`, never
 * a thrown error - vision is an enhancement, not a dependency the add-garment flow can break on.
 *
 * Runs TWO passes per photo (see taxonomy.ts's candidateLabelsForVisionPass1/2): pass 1 gets
 * type-independent traits plus `type` itself; pass 2, only once `type` is confidently known, asks
 * about `category` scoped to JUST that type's own options (instead of competing against all ~45
 * categories across every type at once - the single biggest classification-accuracy fix in this
 * pipeline) plus whichever type-conditional attributes actually apply. This roughly doubles
 * classification latency per photo (two sequential CPU inferences instead of one) - accepted
 * deliberately in exchange for materially better accuracy, per an explicit choice to keep squeezing
 * the free local model rather than switch to a paid vision API.
 */
export class HttpVisionService implements VisionService {
  async analyze(imageBuffer: Buffer): Promise<VisionAnalysisResult | null> {
    const pass1 = await this.runPass(imageBuffer, candidateLabelsForVisionPass1());
    if (!pass1) return null;

    const qualityIssues = pass1.quality?.issues ?? [];
    const floor = env.fashion.vision.minConfidence;
    const detectedType = pass1.type && pass1.type.confidence >= floor ? (pass1.type.value as GarmentType) : null;

    // Can't scope pass 2's category candidates without a confident type - return pass 1 alone
    // rather than asking about category across the full, unscoped taxonomy (that broad-competition
    // approach is exactly the accuracy problem pass 2 exists to avoid).
    if (!detectedType || !GARMENT_TYPES.includes(detectedType)) {
      const result = this.toResult(pass1, null, qualityIssues);
      this.logResult(result);
      return result;
    }

    const pass2 = await this.runPass(imageBuffer, candidateLabelsForVisionPass2(detectedType));
    const result = this.toResult(pass1, pass2, qualityIssues);
    this.logResult(result);
    return result;
  }

  /** One-line-per-field summary of what got detected and how confidently - the trace this pipeline
   *  needs to diagnose a bad classification after the fact (the user's own "trazabilidad" ask)
   *  without having to go dig through the raw ai_metadata JSON blob by hand. */
  private logResult(result: VisionAnalysisResult): void {
    const fields = Object.entries(result.fieldMeta)
      .map(([field, meta]) => `${field}=${(result as unknown as Record<string, unknown>)[field] ?? '?'}(${meta.tier})`)
      .join(' ');
    console.log('[FASHION] Vision (modelo=%s): %s%s', result.modelName ?? '?', fields || '(nada por encima del umbral)', result.qualityIssues.length ? ` calidad=${result.qualityIssues.join(',')}` : '');
  }

  private async runPass(imageBuffer: Buffer, taxonomy: TaxonomyCandidates): Promise<AnalyzeResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.fashion.vision.timeoutMs);
    try {
      const response = await this.postWithOneRetry(imageBuffer, taxonomy, controller.signal);
      clearTimeout(timeout);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      console.error('[FASHION] Servicio de visión no disponible:', (err as Error).message);
      return null;
    }
  }

  private async postWithOneRetry(imageBuffer: Buffer, taxonomy: TaxonomyCandidates, signal: AbortSignal): Promise<AnalyzeResponse | null> {
    try {
      return await this.post(imageBuffer, taxonomy, signal);
    } catch (err) {
      console.error('[FASHION] Vision: intento 1/2 falló:', (err as Error).message);
      return this.post(imageBuffer, taxonomy, signal);
    }
  }

  private async post(imageBuffer: Buffer, taxonomy: TaxonomyCandidates, signal: AbortSignal): Promise<AnalyzeResponse | null> {
    const form = new FormData();
    form.append('image', new Blob([imageBuffer]), 'garment.jpg');
    form.append('labels', JSON.stringify(taxonomy.groups));

    const res = await fetch(`${env.fashion.vision.serviceUrl}/analyze`, { method: 'POST', body: form, signal });
    if (!res.ok) {
      console.error('[FASHION] Vision respondió %d', res.status);
      return null;
    }
    return (await res.json()) as AnalyzeResponse;
  }

  /**
   * Pulls embedded garment photos out of a PDF via the same local microservice's /extract-pdf
   * endpoint (see vision-service/pdf_extract.py) - PDF parsing is grouped into the same Python
   * process as the CLIP model rather than a second service, since it's the one place this project
   * already isolates native/heavy-format handling away from Node (see vision-service/README.md's
   * "Por qué existe como proceso separado"). No retry (unlike analyze()'s one-image case): a whole
   * PDF is a heavier request, and a clear failure message beats silently doubling the wait.
   */
  async extractPdfImages(pdfBuffer: Buffer, maxImages: number): Promise<PdfExtractResult | null> {
    const controller = new AbortController();
    // A PDF with several embedded photos takes longer to parse than analyzing one image - same
    // timeout knob as analyze(), just given more headroom rather than a second env var.
    const timeout = setTimeout(() => controller.abort(), env.fashion.vision.timeoutMs * 3);

    try {
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer]), 'garments.pdf');
      form.append('max_images', String(maxImages));

      const res = await fetch(`${env.fashion.vision.serviceUrl}/extract-pdf`, { method: 'POST', body: form, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        console.error('[FASHION] Extracción de PDF respondió %d', res.status);
        return null;
      }
      const body = (await res.json()) as { images: string[]; totalFound: number };
      return { images: body.images.map((b64) => Buffer.from(b64, 'base64')), totalFound: body.totalFound };
    } catch (err) {
      clearTimeout(timeout);
      console.error('[FASHION] Servicio de visión no disponible (extracción de PDF):', (err as Error).message);
      return null;
    }
  }

  private toResult(pass1: AnalyzeResponse, pass2: AnalyzeResponse | null, qualityIssues: string[]): VisionAnalysisResult {
    const floor = env.fashion.vision.minConfidence;
    const fieldMeta: Record<string, FieldMeta> = {};

    // Below the floor -> unknown (null), matching the user's own "unknown antes que inventar" rule
    // rather than storing a low-confidence guess. `fieldName` is the RESULT field name (camelCase,
    // e.g. "waterResistance"), used as the key into fieldMeta/OBSERVED_FIELDS - independent from
    // whatever key the Python side used (snake_case for some, e.g. "water_resistance").
    const pick = (fieldName: string, field?: ScoredValue): string | null => {
      if (!field || field.confidence < floor) return null;
      fieldMeta[fieldName] = {
        confidence: field.confidence,
        tier: confidenceTier(field.confidence),
        certainty: OBSERVED_FIELDS.has(fieldName) ? 'observado' : 'inferido',
      };
      return field.value;
    };

    const style = (pass1.style ?? []).filter((s) => s.confidence >= floor).slice(0, 3);
    if (style.length) {
      const best = style.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      fieldMeta.style = { confidence: best.confidence, tier: confidenceTier(best.confidence), certainty: 'inferido' };
    }

    const secondaryColor = pick('secondaryColors', pass1.secondary_color);
    const type = pick('type', pass1.type);

    // Defensive consistency check (see the user's own "detección de contradicciones" requirement):
    // pass 2's category candidates are already scoped to `type` (see candidateLabelsForVisionPass2),
    // so this should never actually trigger in practice - but if it ever did (a stale/mismatched
    // vision-service deployment, a manual taxonomy edit on one side only), silently storing a
    // category that doesn't belong to its own type would be exactly the kind of inconsistency this
    // whole pipeline exists to prevent. Dropped (not guessed at) and logged loudly if it happens.
    let category = pick('category', pass2?.category);
    if (category && type && typeForCategory(category) !== type) {
      console.error('[FASHION] Inconsistencia categoría/tipo detectada (%s no pertenece a %s) - descartada.', category, type);
      category = null;
      delete fieldMeta.category;
    }

    return {
      type,
      category,
      color: pick('color', pass1.color),
      secondaryColors: secondaryColor ? [secondaryColor] : [],
      pattern: pick('pattern', pass1.pattern),
      style: style.map((s) => s.value),
      formality: pick('formality', pass1.formality),
      fit: pick('fit', pass2?.fit),
      material: pick('material', pass2?.material),
      warmth: pick('warmth', pass2?.warmth),
      waterResistance: pick('waterResistance', pass2?.water_resistance),
      neckline: pick('neckline', pass2?.neckline),
      sleeves: pick('sleeves', pass2?.sleeves),
      closure: pick('closure', pass2?.closure),
      pockets: pick('pockets', pass2?.pockets),
      length: pick('length', pass2?.length),
      fieldMeta,
      qualityIssues,
      modelName: pass2?.model ?? pass1.model ?? null,
      raw: { pass1, pass2 },
    };
  }
}

export const httpVisionService = new HttpVisionService();
