import { checklistsModel, checklistItemsModel } from '../../../models/checklists.model.js';
import type { Checklist, ChecklistItem } from '../../../entities/index.js';

/**
 * Resolves a "list" tool argument by numeric id or by name (case-insensitive substring) - same
 * disambiguation shape as resolveActingUser (see act-on-behalf.ts): zero matches is a "doesn't
 * exist" error, more than one is a "be more specific" error instead of silently guessing which
 * list "películas" meant. Shared by every list-item tool (add/view/check/delete) so they never
 * drift into slightly different lookup behavior from each other.
 */
export function resolveChecklist(userId: number, query: string): Checklist | { error: string } {
  const trimmed = query.trim();
  if (!trimmed) return { error: 'Me falta indicar de qué lista.' };

  const asId = Number(trimmed);
  if (Number.isInteger(asId) && String(asId) === trimmed) {
    const byId = checklistsModel.getById(userId, asId);
    if (byId) return byId;
    return { error: `No encontré la lista ⟦${asId}⟧.` };
  }

  const matches = findListsByName(userId, trimmed);
  if (matches.length === 0) {
    // Name the lists that DO exist, so a near-miss isn't reported to the person as "no tienes nada".
    const existing = checklistsModel.list(userId);
    if (existing.length === 0) return { error: `No tienes ninguna lista todavía. Usa create_list para crearla.` };
    return {
      error:
        `Ninguna lista coincide con "${trimmed}". Las listas que SÍ existen son: ${existing.map((l) => `"${l.name}" (⟦${l.id}⟧)`).join(', ')}. ` +
        'Si una de ellas es la que me piden, vuelve a llamar con su id; si ninguna es, dilo mostrando estas.',
    };
  }
  if (matches.length > 1) {
    return {
      error: `Hay varias listas que coinciden con "${trimmed}": ${matches.map((l) => `"${l.name}" (⟦${l.id}⟧)`).join(', ')}. Sé más específico o usa el id.`,
    };
  }
  return matches[0];
}

/** Lowercase, no accents, no punctuation - "Películas!" and "peliculas" compare equal. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "mi lista de compras", "las listas de películas" -> "compras", "peliculas". */
function stripListWords(folded: string): string {
  return folded.replace(/^(?:(?:mi|mis|la|las|el|los|una)\s+)?(?:listas?\s*(?:de|del|con|para)?\s*)?/, '').trim();
}

/**
 * Matches the way people actually name a list in chat: accents/case don't matter and "mi lista de"
 * is ignored. An exact (folded) name wins outright; otherwise either side containing the other.
 */
function findListsByName(userId: number, query: string): Checklist[] {
  const q = fold(query);
  const core = stripListWords(q) || q;
  const all = checklistsModel.list(userId).map((l) => ({ l, name: fold(l.name), core: stripListWords(fold(l.name)) || fold(l.name) }));
  const exact = all.filter((x) => x.name === q || x.core === core);
  if (exact.length > 0) return exact.map((x) => x.l);
  return all.filter((x) => x.name.includes(core) || core.includes(x.core)).map((x) => x.l);
}

const SHOW_RE =
  /^(?:(?:muestrame|mostrame|ensename|dame|pasame|enviame|mandame|ver|a ver|quiero ver|abre|abreme|que tengo en|que hay en|que tiene)\s+)?(?:(?:mi|mis|la|las|el)\s+)?(.+)$/;

/**
 * A message that is nothing but one of the person's lists asked for by name - "mi lista de
 * películas", "muéstrame Pendientes", "mis pendientes" when a list is called that. Returns that
 * list's id only on an exact name match (accents/case and "lista de" aside), never a guess: anything
 * else goes to the model as usual.
 */
export function checklistAsked(userId: number, text: string): number | null {
  const t = fold(text);
  if (!t || t.length > 60) return null;
  const m = SHOW_RE.exec(t);
  if (!m) return null;
  const asked = stripListWords(m[1]) || m[1];
  const said = /\blistas?\b/.test(t);
  const hits = checklistsModel.list(userId).filter((l) => {
    const name = fold(l.name);
    // Without the word "lista" only the full name counts ("mis pendientes" -> "Pendientes").
    return said ? name === asked || stripListWords(name) === asked : name === m[1] || name === asked;
  });
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Same idea as resolveChecklist above, but for one item within an already-resolved list - shared
 * by check_list_item and delete_list_item so both fail/disambiguate identically instead of two
 * copies of this logic drifting apart.
 */
export function resolveChecklistItem(userId: number, list: Checklist, query: string): ChecklistItem | { error: string } {
  const trimmed = query.trim();
  if (!trimmed) return { error: 'Me falta indicar qué ítem.' };

  const asId = Number(trimmed);
  if (Number.isInteger(asId) && String(asId) === trimmed) {
    const byId = checklistItemsModel.getById(userId, asId);
    if (byId && byId.checklist_id === list.id) return byId;
    return { error: `No encontré el ítem ⟦${asId}⟧ en "${list.name}".` };
  }

  const matches = checklistItemsModel.findByTitle(list.id, trimmed);
  if (matches.length === 0) return { error: `No encontré ningún ítem que coincida con "${trimmed}" en "${list.name}".` };
  if (matches.length > 1) {
    return {
      error: `Hay varios ítems que coinciden con "${trimmed}" en "${list.name}": ${matches.map((i) => `"${i.title}" (⟦${i.id}⟧)`).join(', ')}. Sé más específico.`,
    };
  }
  return matches[0];
}
