import { categoriesView } from '../views.js';
import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const listCategoriesTool: Tool = {
  name: 'list_categories',
  description:
    'Lista todas las categorías existentes (para links, tareas y recordatorios) con cuántos links tiene guardados cada una. ' +
    'Úsala para "qué categorías hay" y para "en cuál tengo algo/links" (no list_links, que suelta todos los links). ' +
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
    const linkCounts = new Map<number, number>();
    for (const link of linksRepo.listByCategory(acting.userId)) {
      if (link.category_id != null) linkCounts.set(link.category_id, (linkCounts.get(link.category_id) ?? 0) + 1);
    }
    return categoriesView(categories, linkCounts);
  },
};
