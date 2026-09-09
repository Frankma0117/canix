import { checklistsRepo, checklistItemsRepo } from '../../db/repositories/checklists.repo.js';
import type { Checklist, ChecklistItem } from '../../types/index.js';

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
    const byId = checklistsRepo.getById(userId, asId);
    if (byId) return byId;
    return { error: `No encontré la lista #${asId}.` };
  }

  const matches = checklistsRepo.findByName(userId, trimmed);
  if (matches.length === 0) return { error: `No tienes ninguna lista llamada "${trimmed}". Usa create_list para crearla.` };
  if (matches.length > 1) {
    return {
      error: `Hay varias listas que coinciden con "${trimmed}": ${matches.map((l) => `"${l.name}" (#${l.id})`).join(', ')}. Sé más específico o usa el id.`,
    };
  }
  return matches[0];
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
    const byId = checklistItemsRepo.getById(userId, asId);
    if (byId && byId.checklist_id === list.id) return byId;
    return { error: `No encontré el ítem #${asId} en "${list.name}".` };
  }

  const matches = checklistItemsRepo.findByTitle(list.id, trimmed);
  if (matches.length === 0) return { error: `No encontré ningún ítem que coincida con "${trimmed}" en "${list.name}".` };
  if (matches.length > 1) {
    return {
      error: `Hay varios ítems que coinciden con "${trimmed}" en "${list.name}": ${matches.map((i) => `"${i.title}" (#${i.id})`).join(', ')}. Sé más específico.`,
    };
  }
  return matches[0];
}
