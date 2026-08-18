import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { intakeGarmentPdf } from '../image/pdf-intake.js';
import { toAnalysisCopy, toThumbnail } from '../image/image-processing.js';
import { spacesStorageService } from '../storage/spaces-storage.service.js';
import { httpVisionService } from '../vision/http-vision.service.js';
import { candidateLabelsForVision, CATEGORIES_BY_TYPE } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import { renderTypeOptions } from './add-garment.flow.js';
import type { FashionSessionData, GarmentDraft } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

/**
 * Bulk garment import from a single PDF (a user's own "photos of my clothes" document) - extracts
 * every embedded photo via the vision microservice's /extract-pdf (see
 * vision-service/pdf_extract.py, PyMuPDF), then runs each one through the SAME
 * resize/upload/analyze pipeline add-garment.flow.ts uses for a single WhatsApp photo. Presented
 * as one batch review (not N sequential yes/no confirmations) - see the user's own "evitar
 * conversaciones excesivamente largas" requirement, which matters even more once N photos are
 * involved than it did for one.
 */
export async function enterPdfImport(ctx: FashionRouterContext): Promise<string> {
  if (!ctx.documentMessage) return HOME_MENU; // router only calls this after confirming a PDF is present

  await ctx.wa.sendText(ctx.jid, '📄 Recibí el PDF, extrayendo las fotos... dame un momento.').catch(() => {});
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_ANALYZING', {});
  console.log('[FASHION] PDF recibido de #%d, procesando...', ctx.userId);

  const intake = await intakeGarmentPdf(ctx.documentMessage);
  if ('error' in intake) return backToHome(ctx.userId, intake.error);

  const extracted = await httpVisionService.extractPdfImages(intake.buffer, env.fashion.maxPdfImages);
  if (extracted === null) {
    return backToHome(
      ctx.userId,
      'No pude procesar el PDF ahora mismo (el servicio de imágenes no está disponible) - probá mandando las fotos una por una, o intenta de nuevo en un rato.',
    );
  }
  if (extracted.images.length === 0) {
    return backToHome(ctx.userId, 'No encontré fotos dentro de ese PDF.');
  }
  console.log('[FASHION] PDF de #%d: %d imagen(es) encontradas, proceso %d.', ctx.userId, extracted.totalFound, extracted.images.length);

  const drafts: GarmentDraft[] = [];
  for (const raw of extracted.images) {
    const draft = await processOneExtractedImage(ctx.userId, raw);
    if (draft) drafts.push(draft);
  }

  if (drafts.length === 0) {
    return backToHome(ctx.userId, 'No pude procesar ninguna de las fotos del PDF. Probá mandándolas sueltas.');
  }

  fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_PDF_REVIEW', { pdfQueue: drafts } satisfies FashionSessionData);
  return renderPdfReview(drafts, { totalFound: extracted.totalFound, processed: extracted.images.length });
}

/** One extracted image through the same steps as a single WhatsApp photo (resize -> upload to
 *  Spaces -> vision analysis) - returns null (never throws) on any failure for THIS ONE image, so
 *  one bad image in the PDF can't abort the rest of the batch. Sequential, not parallel, on
 *  purpose: bounds peak memory/CPU on the 4GB server regardless of how many images the PDF has. */
async function processOneExtractedImage(userId: number, raw: Buffer): Promise<GarmentDraft | null> {
  let analysisCopy: Buffer;
  let thumbnail: Buffer;
  try {
    [analysisCopy, thumbnail] = await Promise.all([toAnalysisCopy(raw), toThumbnail(raw)]);
  } catch (err) {
    console.error('[FASHION] Imagen del PDF inválida, la salto:', (err as Error).message);
    return null;
  }

  const publicId = randomUUID();
  let originalUpload: { key: string; url: string };
  let thumbnailUpload: { key: string; url: string };
  try {
    [originalUpload, thumbnailUpload] = await Promise.all([
      spacesStorageService.uploadOriginal(userId, publicId, raw, 'image/jpeg', 'jpg'),
      spacesStorageService.uploadThumbnail(userId, publicId, thumbnail, 'jpg'),
    ]);
  } catch (err) {
    console.error('[FASHION] Error subiendo una imagen del PDF a Spaces:', (err as Error).message);
    return null;
  }

  const draft: GarmentDraft = {
    publicId,
    storageKey: originalUpload.key,
    imageUrl: originalUpload.url,
    thumbnailKey: thumbnailUpload.key,
    thumbnailUrl: thumbnailUpload.url,
    detectedFields: [],
  };

  const analysis = await httpVisionService.analyze(analysisCopy, candidateLabelsForVision());
  if (analysis) {
    if (analysis.type) {
      draft.type = analysis.type;
      draft.detectedFields!.push('type');
    }
    if (analysis.category) {
      draft.category = analysis.category;
      draft.detectedFields!.push('category');
    }
    if (analysis.color) {
      draft.color = analysis.color;
      draft.detectedFields!.push('color');
    }
    if (analysis.pattern) draft.pattern = analysis.pattern;
    if (analysis.style.length) draft.style = analysis.style;
    if (analysis.formality) draft.formality = analysis.formality;
    draft.aiMetadata = analysis.raw;
  }

  return draft;
}

function draftSummaryLine(index: number, draft: GarmentDraft): string {
  const categoryLabel =
    (draft.type ? CATEGORIES_BY_TYPE[draft.type as GarmentType]?.find((c) => c.value === draft.category)?.label : undefined) ??
    draft.category;

  if (!draft.type || !draft.category) return `${index + 1}. ⚠️ no se pudo clasificar automáticamente`;
  const colorPart = draft.color ? ` - ${draft.color}` : '';
  return `${index + 1}. ${categoryLabel}${colorPart}`;
}

export function renderPdfReview(drafts: GarmentDraft[], meta?: { totalFound: number; processed: number }): string {
  const lines: string[] = [];
  if (meta && meta.totalFound > meta.processed) {
    lines.push(`📄 El PDF tenía ${meta.totalFound} fotos, procesé las primeras ${meta.processed}.`, '');
  }
  lines.push(`Encontré ${drafts.length} prenda(s):`, '', ...drafts.map((d, i) => draftSummaryLine(i, d)), '');
  lines.push(
    '✅ "guardar todas" - guarda las que se pudieron clasificar',
    '🔢 escribe el número de una prenda para corregirla (ej. "3")',
    '❌ "cancelar" - descarta todo el lote, no guarda nada',
  );
  return lines.join('\n');
}

export async function handlePdfReview(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const queue = data.pdfQueue;
  if (!queue || queue.length === 0) return { consumed: true, reply: backToHome(ctx.userId, 'Se perdió el progreso, empecemos de nuevo.') };

  const text = ctx.text.trim();

  if (/^cancel/i.test(text)) {
    const keys = queue.flatMap((d) => [d.storageKey, d.thumbnailKey].filter((k): k is string => !!k));
    await spacesStorageService.delete(keys);
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `Cancelado, no guardé nada del PDF.\n\n${HOME_MENU}` };
  }

  if (/^(guardar( todas)?|s(i|í))$/i.test(text)) {
    let saved = 0;
    let skipped = 0;
    for (const draft of queue) {
      if (!draft.type || !draft.category) {
        skipped++;
        continue;
      }
      const id = garmentsRepo.create(ctx.userId, {
        publicId: draft.publicId,
        storageKey: draft.storageKey,
        imageUrl: draft.imageUrl,
        thumbnailKey: draft.thumbnailKey,
        thumbnailUrl: draft.thumbnailUrl,
        type: draft.type,
        category: draft.category,
        color: draft.color,
        pattern: draft.pattern,
        style: draft.style,
        formality: draft.formality,
        aiMetadata: draft.aiMetadata,
      });
      saved++;
      console.log('[FASHION] Prenda #%d guardada (PDF) para el usuario #%d.', id, ctx.userId);
    }
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    const skipNote = skipped > 0 ? `\n${skipped} no se pudieron clasificar automáticamente - mándalas como foto suelta para agregarlas.` : '';
    return { consumed: true, reply: `✅ Guardé ${saved} prenda(s) en tu armario.${skipNote}\n\n${HOME_MENU}` };
  }

  const choice = Number(text);
  if (Number.isInteger(choice) && choice >= 1 && choice <= queue.length) {
    const draft = queue[choice - 1];
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_MANUAL_TYPE', {
      draft,
      pdfQueue: queue,
      pdfEditIndex: choice - 1,
    } satisfies FashionSessionData);
    return { consumed: true, reply: `Prenda ${choice}: ¿qué es?\n\n${renderTypeOptions()}` };
  }

  return { consumed: true, reply: 'No entendí. Escribe "guardar todas", el número de una prenda para corregirla, o "cancelar".' };
}

function backToHome(userId: number, message: string): string {
  fashionSessionsRepo.setState(userId, 'FASHION_HOME', {});
  return `${message}\n\n${HOME_MENU}`;
}
