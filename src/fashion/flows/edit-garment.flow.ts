import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { GARMENT_TYPES, GARMENT_TYPE_LABELS, CATEGORIES_BY_TYPE, COLORS, MATERIALS, FITS, normalizeColor, normalizeToTaxonomy } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import type { FashionSessionData } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

const EDITABLE_FIELDS = ['type', 'category', 'color', 'material', 'fit', 'favorite'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
const FIELD_LABELS: Record<EditableField, string> = {
  type: 'Tipo',
  category: 'Categoría',
  color: 'Color',
  material: 'Material',
  fit: 'Ajuste',
  favorite: 'Favorito',
};

function categoryLabel(category: string): string {
  for (const cats of Object.values(CATEGORIES_BY_TYPE)) {
    const match = cats.find((c) => c.value === category);
    if (match) return match.label;
  }
  return category;
}

export function showGarmentDetail(userId: number, garmentId: number): string {
  const garment = garmentsRepo.getById(userId, garmentId);
  if (!garment) {
    fashionSessionsRepo.setState(userId, 'FASHION_HOME', {});
    return `No encontré esa prenda.\n\n${HOME_MENU}`;
  }

  fashionSessionsRepo.setState(userId, 'FASHION_GARMENT_DETAIL', { selectedGarmentId: garmentId } satisfies FashionSessionData);

  const header = garment.favorite ? '❤️ ' : '';
  const description = garment.long_description ?? `${categoryLabel(garment.category)}${garment.color ? `, color ${garment.color}` : ''}.`;

  const lines = [
    `${header}${description}`,
    `🖼️ ${garment.image_url}`,
  ];

  let confidenceMeta: Record<string, { tier: string }> = {};
  try {
    confidenceMeta = garment.analysis_confidence ? JSON.parse(garment.analysis_confidence) : {};
  } catch {
    confidenceMeta = {};
  }
  if (Object.values(confidenceMeta).some((m) => m.tier === 'baja')) {
    lines.push('⚠️ Algunos datos son una estimación con confianza baja.');
  }

  lines.push('', '1. Marcar/quitar favorito', '2. Editar', '3. Eliminar', '4. Volver al armario');

  return lines.join('\n');
}

export async function handleGarmentDetail(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const garmentId = data.selectedGarmentId;
  // Re-validate ownership on every turn here (not just once when the id was first selected) -
  // selectedGarmentId lives in session data, so defense in depth against it ever pointing at a
  // garment that isn't (or no longer is) this user's own is cheap and worth it.
  if (!garmentId || !garmentsRepo.getById(ctx.userId, garmentId)) return backToHome(ctx.userId);

  const text = ctx.text.trim();

  if (text === '1') {
    const garment = garmentsRepo.getById(ctx.userId, garmentId)!;
    garmentsRepo.setFavorite(ctx.userId, garmentId, !garment.favorite);
    return { consumed: true, reply: showGarmentDetail(ctx.userId, garmentId) };
  }

  if (text === '2') {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_EDIT_GARMENT_SELECT', { selectedGarmentId: garmentId } satisfies FashionSessionData);
    const options = EDITABLE_FIELDS.map((f, i) => `${i + 1}. ${FIELD_LABELS[f]}`).join('\n');
    return { consumed: true, reply: `¿Qué quieres cambiar?\n\n${options}` };
  }

  if (text === '3') {
    const { enterDeleteConfirm } = await import('./delete-garment.flow.js');
    return { consumed: true, reply: enterDeleteConfirm(ctx.userId, garmentId) };
  }

  if (text === '4' || /^volver/i.test(text)) {
    const { enterWardrobeList } = await import('./list-garments.flow.js');
    return { consumed: true, reply: enterWardrobeList(ctx.userId, data.filter ?? {}) };
  }

  return { consumed: true, reply: showGarmentDetail(ctx.userId, garmentId) };
}

export async function handleEditSelect(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const garmentId = data.selectedGarmentId;
  if (!garmentId || !garmentsRepo.getById(ctx.userId, garmentId)) return backToHome(ctx.userId);

  const choice = Number(ctx.text.trim());
  const field = Number.isInteger(choice) && choice >= 1 && choice <= EDITABLE_FIELDS.length ? EDITABLE_FIELDS[choice - 1] : undefined;
  if (!field) {
    const options = EDITABLE_FIELDS.map((f, i) => `${i + 1}. ${FIELD_LABELS[f]}`).join('\n');
    return { consumed: true, reply: `Elige un número:\n\n${options}` };
  }

  if (field === 'favorite') {
    const garment = garmentsRepo.getById(ctx.userId, garmentId)!;
    garmentsRepo.setFavorite(ctx.userId, garmentId, !garment.favorite);
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_GARMENT_DETAIL', { selectedGarmentId: garmentId });
    return { consumed: true, reply: showGarmentDetail(ctx.userId, garmentId) };
  }

  fashionSessionsRepo.setState(ctx.userId, 'FASHION_EDIT_GARMENT_FIELD', {
    selectedGarmentId: garmentId,
    editingField: field,
  } satisfies FashionSessionData);

  if (field === 'type') return { consumed: true, reply: `Nuevo tipo:\n\n${GARMENT_TYPES.map((t, i) => `${i + 1}. ${GARMENT_TYPE_LABELS[t]}`).join('\n')}` };
  if (field === 'category') return { consumed: true, reply: '¿Cuál es la categoría nueva? (ej. "camisa", "jeans")' };
  if (field === 'material') return { consumed: true, reply: `¿Cuál material? (ej. ${MATERIALS.slice(0, 4).join(', ')}...):` };
  if (field === 'fit') return { consumed: true, reply: `¿Cuál ajuste? (ej. ${FITS.slice(0, 4).join(', ')}...):` };
  return { consumed: true, reply: `Nuevo color (ej. ${COLORS.slice(0, 4).join(', ')}...):` };
}

export async function handleEditField(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const garmentId = data.selectedGarmentId;
  const field = data.editingField as EditableField | undefined;
  if (!garmentId || !field || !garmentsRepo.getById(ctx.userId, garmentId)) return backToHome(ctx.userId);

  const text = ctx.text.trim();

  if (field === 'type') {
    const choice = Number(text);
    const type = Number.isInteger(choice) && choice >= 1 && choice <= GARMENT_TYPES.length ? GARMENT_TYPES[choice - 1] : undefined;
    if (!type) return { consumed: true, reply: `Elige un número:\n\n${GARMENT_TYPES.map((t, i) => `${i + 1}. ${GARMENT_TYPE_LABELS[t]}`).join('\n')}` };
    garmentsRepo.update(ctx.userId, garmentId, { type });
  } else if (field === 'category') {
    const { normalizeCategory, typeForCategory } = await import('../taxonomy.js');
    const category = normalizeCategory(text);
    if (!category) return { consumed: true, reply: `No reconocí esa categoría, ¿me la repites? (ej. "camisa", "jeans", "tenis")` };
    garmentsRepo.update(ctx.userId, garmentId, { category, type: typeForCategory(category) as GarmentType | undefined });
  } else if (field === 'color') {
    if (!text) return { consumed: true, reply: '¿De qué color?' };
    garmentsRepo.update(ctx.userId, garmentId, { color: normalizeColor(text) ?? text.toLowerCase() });
  } else if (field === 'material') {
    if (!text) return { consumed: true, reply: '¿Cuál material?' };
    garmentsRepo.update(ctx.userId, garmentId, { material: normalizeToTaxonomy(MATERIALS, text) ?? text.toLowerCase() });
  } else if (field === 'fit') {
    if (!text) return { consumed: true, reply: '¿Cuál ajuste?' };
    garmentsRepo.update(ctx.userId, garmentId, { fit: normalizeToTaxonomy(FITS, text) ?? text.toLowerCase() });
  }

  // A manual correction can make the generated description stale (e.g. color was fixed but the
  // paragraph still names the old one) - regenerate it from the now-updated row so it never
  // contradicts what was just corrected. Garment's own columns are snake_case/JSON-string
  // (secondary_colors, style) while the description builder wants camelCase/real arrays - convert
  // rather than spread blindly (see the same conversion in revalidate-garments.flow.ts).
  const { buildShortDescription, buildLongDescription } = await import('../description.js');
  const updated = garmentsRepo.getById(ctx.userId, garmentId)!;
  const describable = {
    ...updated,
    secondaryColors: updated.secondary_colors ? (JSON.parse(updated.secondary_colors) as string[]) : [],
    style: updated.style ? (JSON.parse(updated.style) as string[]) : [],
  };
  garmentsRepo.update(ctx.userId, garmentId, {
    shortDescription: buildShortDescription(describable),
    longDescription: buildLongDescription(describable),
  });

  fashionSessionsRepo.setState(ctx.userId, 'FASHION_GARMENT_DETAIL', { selectedGarmentId: garmentId });
  return { consumed: true, reply: `Listo, actualizado.\n\n${showGarmentDetail(ctx.userId, garmentId)}` };
}

function backToHome(userId: number): FashionRouterResult {
  fashionSessionsRepo.setState(userId, 'FASHION_HOME', {});
  return { consumed: true, reply: `Se perdió el contexto, volvamos al inicio.\n\n${HOME_MENU}` };
}
