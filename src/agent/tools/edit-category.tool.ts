import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

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
    const category = categoriesRepo.getById(userId, id);
    if (!category) return `No encontré la categoría #${id}.`;

    const name = args.name ? String(args.name).trim() : undefined;
    if (name) {
      const clash = categoriesRepo.getByName(userId, name);
      if (clash && clash.id !== id) return `Ya existe otra categoría llamada "${clash.name}" (#${clash.id}).`;
    }

    categoriesRepo.update(userId, id, {
      name,
      description: args.description !== undefined ? String(args.description) : undefined,
    });

    const updated = categoriesRepo.getById(userId, id)!;
    return `Categoría #${id} actualizada: "${updated.name}".`;
  },
};
