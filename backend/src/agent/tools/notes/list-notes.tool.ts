import { notesView } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { notesModel } from '../../../models/notes.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const listNotesTool: Tool = {
  name: 'list_notes',
  description: 'Lista mis notas importantes guardadas, opcionalmente filtrando por categoría o por un texto de búsqueda. Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
      search: { type: 'string', description: 'Texto a buscar en título/contenido (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS notas en vez de las tuyas.',
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

    const notes = args.search ? notesModel.search(userId, String(args.search), categoryId) : notesModel.listByCategory(userId, categoryId);
    if (notes.length === 0) return 'No tienes notas que coincidan.';
    return notesView(notes, categoriesModel.listAll(userId), { filter: args.search ? `"${String(args.search)}"` : undefined });
  },
};
