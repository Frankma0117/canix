import type { Tool } from '../../tool-registry.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const deleteCategoryTool: Tool = {
  name: 'delete_category',
  description:
    'Elimina una categoría por su id. Los links/tareas/recordatorios que la usaban quedan sin categoría (no se borran).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la categoría (ver list_categories).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU categoría en vez de la tuya.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const id = Number(args.id);
    const category = categoriesModel.getById(userId, id);
    if (!category) return `No encontré la categoría ⟦${id}⟧.`;
    categoriesModel.remove(userId, id);
    return `Listo, borré la categoría "${category.name}".`;
  },
};
