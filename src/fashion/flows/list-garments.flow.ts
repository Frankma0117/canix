import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo, type GarmentFilters } from '../../db/repositories/garments.repo.js';
import { normalizeCategory, normalizeColor, CATEGORIES_BY_TYPE } from '../taxonomy.js';
import type { FashionSessionData } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

const PAGE_SIZE = 10;

/** Parses trailing filter text ("camisas", "blancos", "favoritos") into GarmentFilters - purely
 *  local/taxonomy-based, zero AI cost (see taxonomy.ts's normalizeCategory/normalizeColor). */
export function parseFilterText(text: string): GarmentFilters {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return {};
  if (/^favorit/.test(trimmed)) return { favorite: true };
  const category = normalizeCategory(trimmed);
  if (category) return { category };
  const color = normalizeColor(trimmed);
  if (color) return { color };
  return { search: trimmed };
}

function categoryLabel(category: string): string {
  for (const cats of Object.values(CATEGORIES_BY_TYPE)) {
    const match = cats.find((c) => c.value === category);
    if (match) return match.label;
  }
  return category;
}

export function enterWardrobeList(userId: number, filter: GarmentFilters): string {
  return renderList(userId, filter, 0);
}

function renderList(userId: number, filter: GarmentFilters, offset: number): string {
  const { rows, total } = garmentsRepo.list(userId, filter, { limit: PAGE_SIZE, offset });

  fashionSessionsRepo.setState(userId, 'FASHION_WARDROBE_LIST', {
    filter,
    offset,
    lastListedIds: rows.map((g) => g.id),
  } satisfies FashionSessionData);

  if (total === 0) {
    return 'No tienes prendas que coincidan.\n\n1. Agregar prenda\n2. Volver';
  }

  const from = offset + 1;
  const to = offset + rows.length;
  const lines = [`👕 Tu armario`, `${from}-${to} de ${total} prendas`, ''];
  rows.forEach((g, i) => {
    const fav = g.favorite ? ' ❤️' : '';
    lines.push(`${i + 1}. ${categoryLabel(g.category)}${g.color ? ` ${g.color}` : ''}${fav}`);
  });

  const nav: string[] = [];
  if (offset + PAGE_SIZE < total) nav.push('"siguiente" - ver más');
  if (offset > 0) nav.push('"anterior" - página anterior');
  if (nav.length) lines.push('', nav.join(' | '));
  lines.push('', 'Responde con un número para ver el detalle, o "volver".');

  return lines.join('\n');
}

export async function handleWardrobeList(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const filter = data.filter ?? {};
  const offset = data.offset ?? 0;
  const text = ctx.text.trim().toLowerCase();

  if (text === 'volver' || text === '2') {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }
  if (text === 'siguiente') {
    return { consumed: true, reply: renderList(ctx.userId, filter, offset + PAGE_SIZE) };
  }
  if (text === 'anterior') {
    return { consumed: true, reply: renderList(ctx.userId, filter, Math.max(0, offset - PAGE_SIZE)) };
  }
  if (text === '1' && (!data.lastListedIds || data.lastListedIds.length === 0)) {
    const { enterAddGarment } = await import('./add-garment.flow.js');
    return { consumed: true, reply: enterAddGarment(ctx.userId) };
  }

  const choice = Number(text);
  const ids = data.lastListedIds ?? [];
  if (Number.isInteger(choice) && choice >= 1 && choice <= ids.length) {
    const { showGarmentDetail } = await import('./edit-garment.flow.js');
    return { consumed: true, reply: showGarmentDetail(ctx.userId, ids[choice - 1]) };
  }

  // Any other text is treated as a new filter, resetting to page 1 - lets "armario" stay active
  // while the user refines ("blancos" after seeing a mixed list, etc.).
  return { consumed: true, reply: renderList(ctx.userId, parseFilterText(text), 0) };
}
