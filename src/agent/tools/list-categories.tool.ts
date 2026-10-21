import { categoriesView } from '../views.js';
import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const listCategoriesTool: Tool = {
  name: 'list_categories',
  description:
    'Lista todas mis categorías. Son GENERALES: una misma categoría agrupa links, notas, recordatorios, tareas y ' +
    'recetas, y la lista dice cuánto de cada cosa tiene. Úsala para "qué categorías hay", "en cuál tengo algo/links" ' +
    '(no list_links, que suelta todos los links) y antes de guardar algo en una categoría. ' +
    'Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
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
    if (categories.length === 0) return 'Todavía no tienes categorías creadas.';
    return categoriesView(categories, categoriesRepo.usage(acting.userId));
  },
};
