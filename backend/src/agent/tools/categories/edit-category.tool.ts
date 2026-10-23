import type { Tool } from '../../tool-registry.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const editCategoryTool: Tool = {
  name: 'edit_category',
  description: 'Renombra una categoría existente y/o le cambia la descripción, sin afectar los links/tareas/recordatorios que la usan.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la categoría (ver list_categories).' },
      name: { type: 'string', description: 'Nuevo nombre (opcional).' },
      description: { type: 'string', description: 'Nueva descripción (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU categoría en vez de la tuya.',
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

    const name = args.name ? String(args.name).trim() : undefined;
    if (name) {
      const clash = categoriesModel.getByName(userId, name);
      if (clash && clash.id !== id) return `Ya existe otra categoría llamada "${clash.name}" (⟦${clash.id}⟧).`;
    }

    categoriesModel.update(userId, id, {
      name,
      description: args.description !== undefined ? String(args.description) : undefined,
    });

    const updated = categoriesModel.getById(userId, id)!;
    return `Listo, actualicé la categoría ⟦${id}⟧: "${updated.name}".`;
  },
};
