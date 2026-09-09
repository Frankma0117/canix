import type { Tool } from '../tool-registry.js';
import { checklistItemsRepo } from '../../db/repositories/checklists.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import { resolveChecklist } from './resolve-checklist.js';

export const viewListTool: Tool = {
  name: 'view_list',
  description: 'Muestra los ítems de una lista, marcando cuáles ya están marcados (✅) y cuáles no (⬜).',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SU lista en vez de la tuya.',
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

    const items = checklistItemsRepo.list(list.id);
    if (items.length === 0) return `"${list.name}" todavía no tiene ítems - usa add_list_item para agregarle.`;

    const checked = items.filter((i) => i.checked).length;
    const lines = items.map((i) => `${i.checked ? '✅' : '⬜'} #${i.id} ${i.title}`);
    return `📋 *${list.name}* (${checked}/${items.length})\n\n${lines.join('\n')}`;
  },
};
