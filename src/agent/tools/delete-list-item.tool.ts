import type { Tool } from '../tool-registry.js';
import { checklistItemsRepo } from '../../db/repositories/checklists.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import { resolveChecklist, resolveChecklistItem } from './resolve-checklist.js';

export const deleteListItemTool: Tool = {
  name: 'delete_list_item',
  description: 'Elimina un ítem de una lista (para borrar la lista entera usa delete_list, no esta).',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      item: { type: 'string', description: 'Nombre o id del ítem dentro de esa lista.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrarlo de SU lista en vez de la tuya.',
      },
    },
    required: ['list', 'item'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const list = resolveChecklist(userId, String(args.list ?? ''));
    if ('error' in list) return list.error;

    const item = resolveChecklistItem(userId, list, String(args.item ?? ''));
    if ('error' in item) return item.error;

    checklistItemsRepo.remove(userId, item.id);
    return `Listo, borré "${item.title}" de "${list.name}".`;
  },
};
