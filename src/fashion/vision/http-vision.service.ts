import { env } from '../../config/env.js';
import type { TaxonomyCandidates } from '../taxonomy.js';
import type { VisionService, VisionAnalysisResult } from './vision.service.js';

interface ScoredValue {
  value: string;
  confidence: number;
}

interface AnalyzeResponse {
  type?: ScoredValue;
  category?: ScoredValue;
  color?: ScoredValue;
  pattern?: ScoredValue;
  style?: ScoredValue[];
  formality?: ScoredValue;
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
 */
export class HttpVisionService implements VisionService {
  async analyze(imageBuffer: Buffer, taxonomy: TaxonomyCandidates): Promise<VisionAnalysisResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.fashion.vision.timeoutMs);

    try {
      const response = await this.postWithOneRetry(imageBuffer, taxonomy, controller.signal);
      clearTimeout(timeout);
      if (!response) return null;
      return this.toResult(response);
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

  private toResult(response: AnalyzeResponse): VisionAnalysisResult {
    const floor = env.fashion.vision.minConfidence;
    const confidence: Record<string, number> = {};

    const pick = (field?: ScoredValue): string | null => {
      if (!field || field.confidence < floor) return null;
      confidence[field.value] = field.confidence;
      return field.value;
    };

    const style = (response.style ?? []).filter((s) => s.confidence >= floor).slice(0, 3);
    for (const s of style) confidence[s.value] = s.confidence;

    return {
      type: pick(response.type),
      category: pick(response.category),
      color: pick(response.color),
      secondaryColors: [],
      pattern: pick(response.pattern),
      style: style.map((s) => s.value),
      formality: pick(response.formality),
      confidence,
      raw: response,
    };
  }
}

export const httpVisionService = new HttpVisionService();
