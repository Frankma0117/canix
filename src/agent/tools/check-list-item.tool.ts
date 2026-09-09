import type { Tool } from '../tool-registry.js';
import { checklistItemsRepo } from '../../db/repositories/checklists.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import { resolveChecklist, resolveChecklistItem } from './resolve-checklist.js';

export const checkListItemTool: Tool = {
  name: 'check_list_item',
  description:
    'Marca o desmarca un ítem de una lista - ej. "marca Super Mario Odyssey de mi lista de juegos" (checked=true) o ' +
    '"desmarca Interstellar de películas" (checked=false).',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      item: { type: 'string', description: 'Nombre o id del ítem dentro de esa lista.' },
      checked: { type: 'boolean', description: 'true = marcar, false = desmarcar. Default true.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para marcarlo en SU lista en vez de la tuya.',
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

    const checked = args.checked === undefined ? true : Boolean(args.checked);
    checklistItemsRepo.setChecked(userId, item.id, checked);
    return checked ? `✅ Marqué "${item.title}" en "${list.name}".` : `⬜ Desmarqué "${item.title}" en "${list.name}".`;
  },
};
