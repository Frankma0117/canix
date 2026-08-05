import { todosRepo } from '../../db/repositories/todos.repo.js';
import type { Todo } from '../../types/index.js';

/** Shared by exercise tools (add/list) - finds a scope='routine' todo by name, the way every other
 *  "find by name" tool in this codebase does (see contacts/categories findByName). */
export function resolveRoutine(userId: number, routine: string): { todo?: Todo; error?: string } {
  const matches = todosRepo.findByTitle(userId, routine, 'routine');
  if (matches.length === 1) return { todo: matches[0] };
  if (matches.length > 1) {
    return { error: `Hay varias rutinas que coinciden con "${routine}": ${matches.map((m) => m.title).join(', ')}. Sé más específico.` };
  }
  return { error: `No encontré ninguna rutina llamada "${routine}". Créala primero con create_routine.` };
}
