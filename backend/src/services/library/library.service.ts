import { checklistsModel, checklistItemsModel, type MediaFields, type MediaFilter, type MediaItem } from '../../models/checklists.model.js';
import { categoriesModel } from '../../models/categories.model.js';
import { linksModel } from '../../models/links.model.js';
import { notesModel } from '../../models/notes.model.js';
import { LIST_KIND_INFO, MEDIA_KINDS, isMediaKind, listKindOf, type MediaKind } from '../../shared/utils/list-kinds.js';
import type { Checklist, Note } from '../../entities/index.js';
import { normalizeHttpUrl } from '../../shared/utils/urls.js';

/**
 * The media library: movies, series, music, books, games and podcasts the person wants to watch,
 * listen to, read or play - and the ones they already did. Each kind lives in the person's lists of
 * that kind (a list is their own grouping: "Películas", "Rock para entrenar", "Pelis de terror"),
 * and each item can carry who made it, genre, year, a summary, the link it came with, a rating and
 * notes. A link sent with "es una película sobre X" is saved twice on purpose: in the general link
 * library (under the kind's category, e.g. "Películas") and here, pointing at that link.
 */

export interface SaveMediaInput extends MediaFields {
  kind: MediaKind;
  title: string;
  done?: boolean;
  /** Name of the list to keep it in; default = the person's main list of that kind. */
  list?: string;
  /** Category for the link in the general library; default = the kind's label ("Películas"). */
  linkCategory?: string;
}

export interface SaveMediaResult {
  itemId: number;
  listName: string;
  /** false = it was already in the library and was updated instead. */
  created: boolean;
  link?: { id: number; categoryName: string; reused: boolean };
}

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The list a new item of `kind` goes to: the one named, else the person's main list of that kind (created if missing). */
export function resolveMediaList(userId: number, kind: MediaKind, listName?: string): Checklist {
  const lists = checklistsModel.list(userId);
  if (listName?.trim()) {
    const wanted = plain(listName).replace(/^lista (de )?/, '');
    const found = lists.find((l) => plain(l.name) === wanted || plain(l.name).replace(/^lista (de )?/, '') === wanted);
    if (found) return found;
    const id = checklistsModel.create(userId, listName.trim(), kind);
    return checklistsModel.getById(userId, id)!;
  }
  const ofKind = lists.filter((l) => listKindOf(l) === kind);
  const label = plain(LIST_KIND_INFO[kind].label);
  const main = ofKind.find((l) => plain(l.name) === label) ?? ofKind[0];
  if (main) return main;
  const id = checklistsModel.create(userId, LIST_KIND_INFO[kind].label, kind);
  return checklistsModel.getById(userId, id)!;
}

/** The same title already in the library for that kind, in any of its lists. */
function findExisting(userId: number, kind: MediaKind, title: string): MediaItem | undefined {
  const wanted = plain(title);
  return checklistItemsModel.listMedia(userId, { kinds: [kind] }).find((i) => plain(i.title) === wanted);
}

/** Saves the link in the general library (reusing it when the URL is already there). */
function saveLink(userId: number, input: SaveMediaInput): { id: number; categoryName: string; reused: boolean } {
  const url = input.url!.trim();
  const existing = linksModel.search(userId, url).find((l) => l.url === url);
  if (existing) {
    const category = existing.category_id ? categoriesModel.getById(userId, existing.category_id) : undefined;
    return { id: existing.id, categoryName: category?.name ?? 'sin categoría', reused: true };
  }
  const named = input.linkCategory?.trim() ? categoriesModel.getByName(userId, input.linkCategory.trim()) : undefined;
  // The kind's own category ("Películas", "Música"...) is not an invented one: it is where the
  // person asked for it to go by saying what it is.
  const category = named ?? categoriesModel.findOrCreate(userId, LIST_KIND_INFO[input.kind].label);
  const id = linksModel.create(userId, { url, categoryId: category.id, title: input.title, description: input.summary ?? null });
  return { id, categoryName: category.name, reused: false };
}

export function saveMedia(userId: number, rawInput: SaveMediaInput): SaveMediaResult {
  // Only web links are kept: anything else is dropped, never stored or rendered as a link.
  const input = { ...rawInput, url: normalizeHttpUrl(rawInput.url) ?? undefined };
  const title = input.title.trim();
  const link = input.url ? saveLink(userId, input) : undefined;
  const fields: MediaFields = {
    creator: input.creator?.trim() || undefined,
    genre: input.genre?.trim() || undefined,
    year: input.year ?? undefined,
    summary: input.summary?.trim() || undefined,
    url: input.url?.trim() || undefined,
    linkId: link?.id,
    rating: input.rating ?? undefined,
    notes: input.notes?.trim() || undefined,
  };

  const existing = findExisting(userId, input.kind, title);
  if (existing) {
    // Only what was said now is written; what it already had stays.
    const list = input.list?.trim() ? resolveMediaList(userId, input.kind, input.list) : undefined;
    checklistItemsModel.updateMedia(userId, existing.id, { ...fields, checklistId: list?.id });
    if (input.done !== undefined) checklistItemsModel.setChecked(userId, existing.id, input.done);
    return { itemId: existing.id, listName: list?.name ?? existing.list_name, created: false, link };
  }

  const list = resolveMediaList(userId, input.kind, input.list);
  const itemId = checklistItemsModel.addMedia(userId, list.id, title, fields);
  if (input.done) checklistItemsModel.setChecked(userId, itemId, true);
  return { itemId, listName: list.name, created: true, link };
}

export interface MediaQuery extends Omit<MediaFilter, 'kinds'> {
  kind?: MediaKind;
}

export function listMedia(userId: number, query: MediaQuery = {}): MediaItem[] {
  const kinds = query.kind ? [query.kind] : [...MEDIA_KINDS];
  return checklistItemsModel.listMedia(userId, { ...query, kinds }).filter((i) => isMediaKind(i.kind));
}

/** Library items whose title the text names ("Inception", "la de Nolan") - for edits by name. */
export function findMedia(userId: number, query: string, kind?: MediaKind): MediaItem[] {
  const wanted = plain(query);
  const items = listMedia(userId, { kind });
  const exact = items.filter((i) => plain(i.title) === wanted);
  return exact.length ? exact : items.filter((i) => plain(i.title).includes(wanted) || (i.creator && plain(i.creator).includes(wanted)));
}

/** Notes that mention the item by its title (at least 4 letters, so "Up" doesn't match everything). */
export function relatedNotes(userId: number, item: { title: string }, limit = 2): Note[] {
  const title = item.title.trim();
  if (plain(title).length < 4) return [];
  return notesModel.search(userId, title).slice(0, limit);
}
