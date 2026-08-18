import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const listCategoriesTool: Tool = {
  name: 'list_categories',
  description: 'Lista todas las categorías existentes (para links, tareas y recordatorios).',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS categorías en vez de las tuyas.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const categories = categoriesRepo.listAll(acting.userId);
    if (categories.length === 0) return 'No hay categorías creadas todavía.';
    return categories
      .map((c) => `#${c.id} ${c.name}${c.description ? ` - ${c.description}` : ''}`)
      .join('\n');
  },
};
