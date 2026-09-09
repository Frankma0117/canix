import type { Tool } from '../tool-registry.js';
import { checklistsRepo, checklistItemsRepo } from '../../db/repositories/checklists.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const listListsTool: Tool = {
  name: 'list_lists',
  description:
    'Muestra todas tus listas con cuántos ítems tiene cada una marcados/total (ej. "juegos de Mario", "películas por ' +
    'ver"). Para ver el detalle ítem por ítem de una en particular usa view_list.',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS listas en vez de las tuyas.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const lists = checklistsRepo.list(userId);
    if (lists.length === 0) return 'No tienes listas todavía - usa create_list para crear una.';

    return lists
      .map((l) => {
        const items = checklistItemsRepo.list(l.id);
        const checked = items.filter((i) => i.checked).length;
        return `#${l.id} 📋 ${l.name} (${checked}/${items.length} marcados)`;
      })
      .join('\n');
  },
};
