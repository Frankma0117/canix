import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const deleteCategoryTool: Tool = {
  name: 'delete_category',
  description:
    'Elimina una categoría por su id. Los links/tareas/recordatorios que la usaban quedan sin categoría (no se borran).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id de la categoría (ver list_categories).' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const category = categoriesRepo.getById(ctx.userId, id);
    if (!category) return `No encontré la categoría #${id}.`;
    categoriesRepo.remove(ctx.userId, id);
    return `Categoría "${category.name}" eliminada.`;
  },
};
