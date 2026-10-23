import { linksView } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { linksModel } from '../../../models/links.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const listLinksTool: Tool = {
  name: 'list_links',
  description:
    'Lista los links guardados, opcionalmente filtrando por categoría o por un texto de búsqueda. Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
      search: { type: 'string', description: 'Texto a buscar en url/título/descripción (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS links en vez de los tuyos.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesModel.getByName(userId, String(args.category));
      if (!category) return `No tienes ninguna categoría llamada "${args.category}".`;
      categoryId = category.id;
    }

    const links = args.search
      ? linksModel.search(userId, String(args.search), categoryId)
      : linksModel.listByCategory(userId, categoryId);

    if (links.length === 0) return 'No tienes links que coincidan.';
    return linksView(links, categoriesModel.listAll(userId), { filter: args.search ? `"${String(args.search)}"` : undefined });
  },
};
