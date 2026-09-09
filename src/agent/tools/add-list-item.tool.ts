import type { Tool } from '../tool-registry.js';
import { checklistItemsRepo } from '../../db/repositories/checklists.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import { resolveChecklist } from './resolve-checklist.js';

export const addListItemTool: Tool = {
  name: 'add_list_item',
  description:
    'Agrega uno o varios ítems a una lista ya creada (ver create_list) - ej. agregar "Super Mario Odyssey" a la lista ' +
    '"Juegos de Mario", o varios a la vez. Si la lista no existe todavía, créala primero con create_list.',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      items: { type: 'array', items: { type: 'string' }, description: 'Uno o varios ítems a agregar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para agregarle a SU lista en vez de la tuya.',
      },
    },
    required: ['list', 'items'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const list = resolveChecklist(userId, String(args.list ?? ''));
    if ('error' in list) return list.error;

    const rawItems = Array.isArray(args.items) ? args.items : args.items !== undefined ? [args.items] : [];
    const items = rawItems.map((i) => String(i ?? '').trim()).filter(Boolean);
    if (items.length === 0) return 'Me falta el/los ítem(s) a agregar.';

    for (const title of items) checklistItemsRepo.add(userId, list.id, title);
    return `Listo, agregué ${items.length} ítem(s) a "${list.name}": ${items.join(', ')}.`;
  },
};
