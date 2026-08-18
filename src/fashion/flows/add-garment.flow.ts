import { randomUUID } from 'node:crypto';
import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { intakeGarmentImage, extensionForMimetype } from '../image/image-intake.js';
import { spacesStorageService } from '../storage/spaces-storage.service.js';
import { httpVisionService } from '../vision/http-vision.service.js';
import { candidateLabelsForVision, GARMENT_TYPES, GARMENT_TYPE_LABELS, CATEGORIES_BY_TYPE, normalizeColor } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import type { FashionSessionData, GarmentDraft } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

export function enterAddGarment(userId: number): string {
  fashionSessionsRepo.setState(userId, 'FASHION_ADD_GARMENT_WAITING_IMAGE', {});
  return '📸 Envíame una foto de la prenda (o un PDF con varias fotos para agregarlas todas de una), o escribe "cancelar".';
}

export async function handleWaitingImage(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  if (!ctx.imageMessage) {
    if (ctx.text.trim()) {
      return { consumed: true, reply: 'Necesito que me mandes una FOTO de la prenda (o escribe "cancelar").' };
    }
    return { consumed: true }; // bare non-image message, ignore silently, stay waiting
  }

  await ctx.wa.sendText(ctx.jid, '📸 Foto recibida, dame un segundo...').catch(() => {});
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_ANALYZING', {});
  console.log('[FASHION] Imagen recibida de #%d, analizando...', ctx.userId);

  const intake = await intakeGarmentImage(ctx.imageMessage);
  if ('error' in intake) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_WAITING_IMAGE', {});
    return { consumed: true, reply: intake.error };
  }

  const publicId = randomUUID();
  const ext = extensionForMimetype(intake.mimetype);

  let originalUpload: { key: string; url: string };
  let thumbnailUpload: { key: string; url: string };
  try {
    [originalUpload, thumbnailUpload] = await Promise.all([
      spacesStorageService.uploadOriginal(ctx.userId, publicId, intake.original, intake.mimetype, ext),
      spacesStorageService.uploadThumbnail(ctx.userId, publicId, intake.thumbnail, 'jpg'),
    ]);
  } catch (err) {
    console.error('[FASHION] Error subiendo a Spaces:', (err as Error).message);
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_WAITING_IMAGE', {});
    return { consumed: true, reply: 'No pude guardar la imagen. Inténtalo nuevamente.' };
  }
  console.log('[FASHION] Imagen subida a Spaces (%s) para #%d.', originalUpload.key, ctx.userId);

  const draft: GarmentDraft = {
    publicId,
    storageKey: originalUpload.key,
    imageUrl: originalUpload.url,
    thumbnailKey: thumbnailUpload.key,
    thumbnailUrl: thumbnailUpload.url,
    detectedFields: [],
  };

  const analysis = await httpVisionService.analyze(intake.analysisCopy, candidateLabelsForVision());
  if (analysis) {
    console.log('[FASHION] Prenda analizada para #%d (vision ok).', ctx.userId);
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
  } else {
    console.log('[FASHION] Vision no disponible para #%d, sigue manual.', ctx.userId);
  }

  if (draft.type && draft.category) {
    return { consumed: true, reply: showConfirmation(ctx.userId, draft) };
  }

  // Vision unavailable or too unsure - manual fallback, cascading type -> category -> color.
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_MANUAL_TYPE', { draft } satisfies FashionSessionData);
  return {
    consumed: true,
    reply: `No pude analizar la foto automáticamente 🙈 ¿me cuentas tú qué es?\n\n${renderTypeOptions()}`,
  };
}

export function renderTypeOptions(): string {
  return GARMENT_TYPES.map((t, i) => `${i + 1}. ${GARMENT_TYPE_LABELS[t]}`).join('\n');
}

function renderCategoryOptions(type: GarmentType): string {
  return CATEGORIES_BY_TYPE[type].map((c, i) => `${i + 1}. ${c.label}`).join('\n');
}

export async function handleManualType(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const draft = data.draft;
  if (!draft) return backToHome(ctx.userId, 'Se perdió el progreso, empecemos de nuevo.');

  const choice = Number(ctx.text.trim());
  const type = Number.isInteger(choice) && choice >= 1 && choice <= GARMENT_TYPES.length ? GARMENT_TYPES[choice - 1] : undefined;
  if (!type) return { consumed: true, reply: `Elige un número de la lista:\n\n${renderTypeOptions()}` };

  draft.type = type;
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_MANUAL_CATEGORY', {
    draft,
    pdfQueue: data.pdfQueue,
    pdfEditIndex: data.pdfEditIndex,
  } satisfies FashionSessionData);
  return { consumed: true, reply: `Perfecto. ¿Cuál categoría?\n\n${renderCategoryOptions(type)}` };
}

export async function handleManualCategory(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const draft = data.draft;
  if (!draft || !draft.type) return backToHome(ctx.userId, 'Se perdió el progreso, empecemos de nuevo.');

  const options = CATEGORIES_BY_TYPE[draft.type as GarmentType];
  const choice = Number(ctx.text.trim());
  const category = Number.isInteger(choice) && choice >= 1 && choice <= options.length ? options[choice - 1].value : undefined;
  if (!category) return { consumed: true, reply: `Elige un número de la lista:\n\n${renderCategoryOptions(draft.type as GarmentType)}` };

  draft.category = category;
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_MANUAL_COLOR', {
    draft,
    pdfQueue: data.pdfQueue,
    pdfEditIndex: data.pdfEditIndex,
  } satisfies FashionSessionData);
  return { consumed: true, reply: '¿De qué color es? (escríbelo, ej. "blanco", "azul marino")' };
}

export async function handleManualColor(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const draft = data.draft;
  if (!draft) return backToHome(ctx.userId, 'Se perdió el progreso, empecemos de nuevo.');

  const raw = ctx.text.trim();
  if (!raw) return { consumed: true, reply: '¿De qué color es?' };
  // Manual entry allows free text outside the taxonomy (a human describing their own garment
  // isn't the hallucination risk the taxonomy guards against - that's the AI path) - normalize to
  // a known color label when possible, otherwise keep exactly what they typed.
  draft.color = normalizeColor(raw) ?? raw.toLowerCase();

  return { consumed: true, reply: await finishManualEntry(ctx.userId, data, draft) };
}

/** The manual type/category/color cascade is shared between a single photo and correcting one
 *  item of a PDF batch (see fashion/flows/add-garment-pdf.flow.ts) - pdfEditIndex being set is
 *  what tells this final step which one it's finishing: splice back into the batch and return to
 *  the review screen, or go to the normal single-item yes/no confirmation. Dynamic import (not a
 *  static one) to avoid a load-time circular import with add-garment-pdf.flow.ts, which statically
 *  imports renderTypeOptions from this file - same pattern home.flow.ts already uses to call into
 *  this module. */
async function finishManualEntry(userId: number, data: FashionSessionData, draft: GarmentDraft): Promise<string> {
  if (data.pdfEditIndex !== undefined && data.pdfQueue) {
    const queue = [...data.pdfQueue];
    queue[data.pdfEditIndex] = draft;
    const { renderPdfReview } = await import('./add-garment-pdf.flow.js');
    fashionSessionsRepo.setState(userId, 'FASHION_ADD_GARMENT_PDF_REVIEW', { pdfQueue: queue } satisfies FashionSessionData);
    return `Listo, prenda ${data.pdfEditIndex + 1} actualizada.\n\n${renderPdfReview(queue)}`;
  }
  return showConfirmation(userId, draft);
}

function showConfirmation(userId: number, draft: GarmentDraft): string {
  fashionSessionsRepo.setState(userId, 'FASHION_ADD_GARMENT_CONFIRMATION', { draft } satisfies FashionSessionData);

  const categoryLabel =
    (draft.type ? CATEGORIES_BY_TYPE[draft.type as GarmentType]?.find((c) => c.value === draft.category)?.label : undefined) ??
    draft.category;

  const lines = ['Detecté:', `👕 ${categoryLabel ?? '(sin definir)'}`];
  if (draft.color) lines.push(`🎨 Color: ${draft.color}`);
  if (draft.style?.length) lines.push(`✨ Estilo: ${draft.style.join(', ')}`);
  if (draft.pattern) lines.push(`🧵 Patrón: ${draft.pattern}`);
  lines.push('', '1. Sí, guardar así', '2. Corregir algo', '3. Cancelar');
  return lines.join('\n');
}

export async function handleConfirmation(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const draft = data.draft;
  if (!draft) return backToHome(ctx.userId, 'Se perdió el progreso, empecemos de nuevo.');

  const choice = ctx.text.trim();

  if (choice === '1' || /^s(i|í)/i.test(choice)) {
    const id = garmentsRepo.create(ctx.userId, {
      publicId: draft.publicId,
      storageKey: draft.storageKey,
      imageUrl: draft.imageUrl,
      thumbnailKey: draft.thumbnailKey,
      thumbnailUrl: draft.thumbnailUrl,
      type: draft.type!,
      category: draft.category!,
      color: draft.color,
      pattern: draft.pattern,
      style: draft.style,
      formality: draft.formality,
      aiMetadata: draft.aiMetadata,
    });
    console.log('[FASHION] Prenda #%d guardada para el usuario #%d.', id, ctx.userId);
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `✅ Prenda #${id} guardada en tu armario.\n\n${HOME_MENU}` };
  }

  if (choice === '2' || /^corregir/i.test(choice)) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_MANUAL_TYPE', { draft });
    return { consumed: true, reply: `¿Qué es?\n\n${renderTypeOptions()}` };
  }

  if (choice === '3' || /^cancel/i.test(choice)) {
    await spacesStorageService.delete([draft.storageKey, draft.thumbnailKey].filter((k): k is string => !!k));
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `Cancelado, no guardé nada.\n\n${HOME_MENU}` };
  }

  return { consumed: true, reply: '1. Sí, guardar así\n2. Corregir algo\n3. Cancelar' };
}

function backToHome(userId: number, message: string): FashionRouterResult {
  fashionSessionsRepo.setState(userId, 'FASHION_HOME', {});
  return { consumed: true, reply: `${message}\n\n${HOME_MENU}` };
}
