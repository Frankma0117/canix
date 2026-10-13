import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo, type GarmentFilters } from '../../db/repositories/garments.repo.js';
import type { GarmentType } from '../taxonomy.js';
import { plainText, takeWords, CATEGORY_WORDS, COLOR_WORDS, TYPE_WORDS } from '../outfit/request.js';
import { categoryLabel, colorFor, garmentLabel, humanize, TYPE_TITLES } from '../look.js';
import { keycap } from '../../util/wa-format.js';
import type { FashionSessionData } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

const PAGE_SIZE = 10;

/**
 * Reads a wardrobe filter that can combine several things at once - "camisas blancas", "zapatos
 * negros favoritos", "accesorios", "chaquetas de cuero" - into GarmentFilters. Purely local, zero
 * AI cost (see outfit/request.ts for the vocabulary); words it doesn't know become a text search
 * over each garment's description, so "de cuero" or a brand still narrows the list.
 */
export function parseFilterText(text: string): GarmentFilters {
  let rest = plainText(text);
  if (!rest || /^(todo|todas|todos|completo)$/.test(rest)) return {};
  const filters: GarmentFilters = {};

  if (/\bfavorit[oa]s?\b/.test(rest)) {
    filters.favorite = true;
    rest = rest.replace(/\bfavorit[oa]s?\b/g, ' ');
  }
  const type = takeWords(rest, TYPE_WORDS);
  if (type.found[0]) filters.type = type.found[0].value;
  const category = takeWords(type.rest, CATEGORY_WORDS);
  if (category.found[0]) filters.category = category.found[0].value;
  const color = takeWords(category.rest, COLOR_WORDS);
  if (color.found[0]) filters.color = color.found[0].value;

  const leftover = color.rest
    .replace(/~+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !['los', 'las', 'mis', 'del', 'con', 'color', 'ver', 'solo', 'que', 'sean', 'son', 'tengo'].includes(w));
  if (leftover.length) filters.search = leftover.join(' ');
  // a type named as a group is redundant once a concrete garment was named too
  if (filters.category) delete filters.type;
  return filters;
}

/** "camisas · blanco · favoritos" - the active filter, for the list's title. */
function filterLabel(filter: GarmentFilters): string {
  return [
    filter.type ? TYPE_TITLES[filter.type as GarmentType]?.toLowerCase() : null,
    filter.category ? categoryLabel(filter.category).toLowerCase() : null,
    filter.color ? (filter.category ? colorFor(filter.category, filter.color) : humanize(filter.color)) : null,
    filter.favorite ? 'favoritos' : null,
    filter.search ? `"${filter.search}"` : null,
  ]
    .filter(Boolean)
    .join(' · ');
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

  const label = filterLabel(filter);
  if (total === 0) {
    return (
      `👗 *Tu armario*${label ? ` · ${label}` : ''}\n` +
      `${label ? 'No tienes prendas así.' : 'Todavía no tienes prendas guardadas.'}\n\n` +
      `1️⃣  📸 Agregar prenda\n2️⃣  ↩️ Volver${label ? '\n\n> O prueba otro filtro: "camisas", "zapatos negros", "favoritos"' : ''}`
    );
  }

  const lines = [`👗 *Tu armario*${label ? ` · ${label}` : ''}`, `${offset + 1}–${offset + rows.length} de ${total} prendas`, ''];
  rows.forEach((g, i) => lines.push(`${keycap(i + 1)}  ${garmentLabel(g)}`));

  const nav = [offset + PAGE_SIZE < total ? '*siguiente*' : null, offset > 0 ? '*anterior*' : null, '*volver*'].filter(Boolean).join(' · ');
  lines.push('', '> Escribe el número para ver una prenda', `> ${nav}`, '> O filtra: "camisas blancas", "zapatos negros", "favoritos"');
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
