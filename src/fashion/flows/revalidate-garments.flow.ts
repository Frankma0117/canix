import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { httpVisionService } from '../vision/http-vision.service.js';
import { CATEGORIES_BY_TYPE, ANALYSIS_VERSION } from '../taxonomy.js';
import { toAnalysisCopy } from '../image/image-processing.js';
import { buildShortDescription, buildLongDescription } from '../description.js';
import type { GarmentType } from '../taxonomy.js';
import type { Garment } from '../../types/index.js';
import type { FieldMeta } from '../vision/vision.service.js';
import type { FashionRouterContext } from '../router-types.js';

/** Raw-command entry vocabulary for re-running vision on the whole existing wardrobe - matched
 *  whole-string in router.ts, same discipline as every other Fashion Mode entry keyword. */
export const REVALIDATE_KEYWORDS = [
  'actualizar ropa',
  'actualizar armario',
  'actualizar prendas',
  'revalidar armario',
  'revalidar ropa',
  'reclasificar',
  'reclasificar armario',
  'reclasificar prendas',
  'verificar armario',
  'verificar ropa',
];

// A new answer only replaces an old one if it isn't a CLEAR downgrade in confidence - re-running an
// otherwise-identical photo through the same model can jitter a few points either way, but a big
// drop (e.g. old was "alta" 0.92, new is "baja" 0.45) more likely means this particular pass had a
// worse read on the photo, not that the old answer was wrong. See the user's own "no sobrescribir
// automáticamente un dato de alta confianza sin una razón válida" requirement (revalidateOne below).
const CONFIDENCE_REGRESSION_TOLERANCE = 0.15;

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function categoryLabel(type: string, category: string): string {
  const match = CATEGORIES_BY_TYPE[type as GarmentType]?.find((c) => c.value === category);
  return match?.label ?? category;
}

/** Re-downloads a garment's own already-uploaded photo from its public Spaces URL - no re-upload,
 *  just re-reads the same bytes so they can go through vision again with the current (possibly
 *  expanded/improved) taxonomy and color logic. Never throws - a transient fetch failure just skips
 *  that one garment, same "one bad item can't abort the batch" spirit as the PDF import flow. */
async function fetchStoredImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function describeChange(label: string, before: string | null, after: string): string {
  return `${label}: ${before ?? '(sin definir)'} → ${after}`;
}

function parseOldFieldMeta(garment: Garment): Record<string, FieldMeta> {
  if (!garment.analysis_confidence) return {};
  try {
    const parsed = JSON.parse(garment.analysis_confidence);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, FieldMeta>) : {};
  } catch {
    return {};
  }
}

/**
 * Re-runs vision analysis on every one of a user's already-saved garments and updates whatever the
 * (current, possibly improved since they were first added) model detects - the "cada que le diga
 * actualizar ropa... debe volver a validar las prendas y verificar colores y demás" feature. Only
 * ever WRITES fields vision actually returned this time (see garmentsRepo.update's undefined-keeps-
 * current semantics) - a field vision couldn't confidently re-detect this pass is left as it was,
 * never blanked out. Sequential (not parallel/Promise.all), same reasoning as the PDF import: bounds
 * peak memory/CPU on the small server regardless of wardrobe size.
 */
export async function revalidateWardrobe(ctx: FashionRouterContext): Promise<string> {
  const garments = garmentsRepo.listAllActive(ctx.userId);
  if (garments.length === 0) return 'Todavía no tienes prendas guardadas para revisar - agrega algunas primero.';

  await ctx.wa
    .sendText(ctx.jid, `🔄 Revisando tus ${garments.length} prenda(s) una por una, dame un momento (puede tardar)...`)
    .catch(() => {});
  console.log('[FASHION] Usuario #%d pidió revalidar %d prenda(s).', ctx.userId, garments.length);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const changeLines: string[] = [];

  for (const garment of garments) {
    const summary = await revalidateOne(ctx.userId, garment);
    if (summary === 'failed') {
      failed++;
      continue;
    }
    if (summary.length === 0) {
      unchanged++;
      continue;
    }
    updated++;
    changeLines.push(`#${garment.id} ${categoryLabel(garment.type, garment.category)}: ${summary.join(', ')}`);
  }

  const lines = [
    `✅ Listo, revisé ${garments.length} prenda(s): ${updated} actualizada(s), ${unchanged} sin cambios` +
      `${failed ? `, ${failed} no se pudieron revisar (foto no disponible o servicio de visión caído)` : ''}.`,
  ];
  if (changeLines.length) {
    lines.push('', ...changeLines.slice(0, 15));
    if (changeLines.length > 15) lines.push(`...y ${changeLines.length - 15} más.`);
  }
  return lines.join('\n');
}

/** Returns 'failed' (couldn't even try), an empty array (tried, nothing changed), or the list of
 *  human-readable changes applied to this one garment. */
async function revalidateOne(userId: number, garment: Garment): Promise<'failed' | string[]> {
  const raw = await fetchStoredImage(garment.image_url);
  if (!raw) return 'failed';

  let analysisCopy: Buffer;
  try {
    analysisCopy = await toAnalysisCopy(raw);
  } catch {
    return 'failed';
  }

  const analysis = await httpVisionService.analyze(analysisCopy);
  if (!analysis) return 'failed';

  const oldMeta = parseOldFieldMeta(garment);

  /** True unless the new answer for this field is a CLEAR confidence downgrade from what's
   *  already stored - see CONFIDENCE_REGRESSION_TOLERANCE above. */
  const worthApplying = (fieldName: string): boolean => {
    const oldConfidence = oldMeta[fieldName]?.confidence;
    const newConfidence = analysis.fieldMeta[fieldName]?.confidence;
    if (oldConfidence === undefined || newConfidence === undefined) return true;
    return oldConfidence - newConfidence <= CONFIDENCE_REGRESSION_TOLERANCE;
  };

  const changes: string[] = [];
  const patch: Parameters<typeof garmentsRepo.update>[2] = {};

  const maybeApply = <F extends 'color' | 'pattern' | 'fit' | 'material' | 'warmth' | 'neckline' | 'sleeves' | 'closure' | 'pockets' | 'length'>(
    field: F,
    label: string,
    newValue: string | null,
    oldValue: string | null,
  ): void => {
    if (!newValue || newValue === oldValue || !worthApplying(field)) return;
    changes.push(describeChange(label, oldValue, newValue));
    (patch as Record<string, unknown>)[field] = newValue;
  };

  maybeApply('color', 'color', analysis.color, garment.color);
  maybeApply('pattern', 'patrón', analysis.pattern, garment.pattern);
  maybeApply('fit', 'ajuste', analysis.fit, garment.fit);
  maybeApply('material', 'material', analysis.material, garment.material);
  maybeApply('warmth', 'calidez', analysis.warmth, garment.warmth);
  maybeApply('neckline', 'cuello', analysis.neckline, garment.neckline);
  maybeApply('sleeves', 'mangas', analysis.sleeves, garment.sleeves);
  maybeApply('closure', 'cierre', analysis.closure, garment.closure);
  maybeApply('pockets', 'bolsillos', analysis.pockets, garment.pockets);
  maybeApply('length', 'largo', analysis.length, garment.length);

  if (analysis.waterResistance && analysis.waterResistance !== garment.water_resistance && worthApplying('waterResistance')) {
    changes.push(describeChange('resistencia al agua', garment.water_resistance, analysis.waterResistance));
    patch.waterResistance = analysis.waterResistance;
  }
  // category can genuinely change now that it's scoped to the (already-known, unchanging) type -
  // e.g. a photo first misread as "camiseta" that a sharper re-analysis now reads as "polo".
  if (analysis.category && analysis.category !== garment.category && worthApplying('category')) {
    changes.push(describeChange('categoría', categoryLabel(garment.type, garment.category), categoryLabel(garment.type, analysis.category)));
    patch.category = analysis.category;
  }
  if (analysis.secondaryColors.length) patch.secondaryColors = analysis.secondaryColors;
  if (analysis.style.length) patch.style = analysis.style;
  if (analysis.formality) patch.formality = analysis.formality;

  if (Object.keys(patch).length === 0) return [];

  // Regenerate the description from the POST-patch values, not the stale pre-update garment row.
  // Built field-by-field (not a blind `{...garment, ...patch}` spread) because Garment's own columns
  // are snake_case/JSON-string (garment.secondary_colors, garment.style) while patch/DescribableGarment
  // use camelCase/real arrays - a blind spread would silently carry the wrong-shaped stale values
  // through for every field the patch itself didn't touch.
  const descriptionInput = {
    type: garment.type,
    category: patch.category ?? garment.category,
    color: patch.color ?? garment.color,
    secondaryColors: patch.secondaryColors ?? parseJsonArray(garment.secondary_colors),
    pattern: patch.pattern ?? garment.pattern,
    material: patch.material ?? garment.material,
    fit: patch.fit ?? garment.fit,
    style: patch.style ?? parseJsonArray(garment.style),
    formality: patch.formality ?? garment.formality,
    neckline: patch.neckline ?? garment.neckline,
    sleeves: patch.sleeves ?? garment.sleeves,
    closure: patch.closure ?? garment.closure,
    pockets: patch.pockets ?? garment.pockets,
    length: patch.length ?? garment.length,
  };
  patch.shortDescription = buildShortDescription(descriptionInput);
  patch.longDescription = buildLongDescription(descriptionInput);
  patch.analysisConfidence = { ...oldMeta, ...analysis.fieldMeta };
  if (analysis.modelName) {
    patch.analysisModel = analysis.modelName;
    patch.analysisVersion = ANALYSIS_VERSION;
    patch.analyzedAt = new Date().toISOString();
  }

  garmentsRepo.update(userId, garment.id, patch);
  return changes;
}

