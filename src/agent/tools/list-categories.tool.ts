import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const listCategoriesTool: Tool = {
  name: 'list_categories',
  description: 'Lista todas las categorías existentes (para links, tareas y recordatorios).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute() {
    const categories = categoriesRepo.listAll();
    if (categories.length === 0) return 'No hay categorías creadas todavía.';
    return categories
      .map((c) => `#${c.id} ${c.name}${c.description ? ` - ${c.description}` : ''}`)
      .join('\n');
  },
};
