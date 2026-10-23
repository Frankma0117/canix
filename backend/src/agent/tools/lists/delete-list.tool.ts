import type { Tool } from '../../tool-registry.js';
import { checklistsModel } from '../../../models/checklists.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { resolveChecklist } from '../shared/resolve-checklist.js';

export const deleteListTool: Tool = {
  name: 'delete_list',
  description: 'Elimina una lista entera junto con todos sus ítems (para borrar solo un ítem usa delete_list_item, no esta).',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU lista en vez de la tuya.',
      },
    },
    required: ['list'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const list = resolveChecklist(userId, String(args.list ?? ''));
    if ('error' in list) return list.error;

    checklistsModel.remove(userId, list.id);
    return `Listo, borré la lista "${list.name}" y todos sus ítems.`;
  },
};
