import { listAsText } from '../../../shared/utils/list-kinds.js';
import { listView } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { checklistItemsModel } from '../../../models/checklists.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { resolveChecklist } from '../shared/resolve-checklist.js';

export const viewListTool: Tool = {
  name: 'view_list',
  description: 'Muestra los ítems de una lista, marcando cuáles ya están marcados y cuáles no. Con plain=true la devuelve como texto limpio para copiar y pegar en otro lado. En ambos casos envía lo que devuelve TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      plain: {
        type: 'boolean',
        description:
          'true cuando piden la lista para copiarla, compartirla o pasarla a otro lado: devuelve texto limpio (título y un ítem por línea, sin casillas ni números).',
      },
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

    const items = checklistItemsModel.list(list.id);
    if (items.length === 0) return `"${list.name}" todavía no tiene ítems - usa add_list_item para agregarle.`;

    return args.plain ? listAsText(list, items) : listView(list, items);
  },
};
