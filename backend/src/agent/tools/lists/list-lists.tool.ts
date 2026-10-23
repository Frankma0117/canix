import { listsView } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { checklistsModel, checklistItemsModel } from '../../../models/checklists.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const listListsTool: Tool = {
  name: 'list_lists',
  description:
    'Muestra todas tus listas con cuántos ítems tiene cada una marcados/total (ej. "juegos de Mario", "películas por ' +
    'ver"). Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL. Para ver el detalle ítem por ítem de una ' +
    'en particular usa view_list. Úsala SIEMPRE antes de decir que no hay listas o que una lista no existe.',
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

    const lists = checklistsModel.list(userId);
    if (lists.length === 0) return 'No tienes listas todavía - usa create_list para crear una.';

    return listsView(lists.map((list) => ({ list, items: checklistItemsModel.list(list.id) })));
  },
};
