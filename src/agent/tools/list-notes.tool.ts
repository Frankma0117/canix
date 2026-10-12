import { notesView } from '../views.js';
import type { Tool } from '../tool-registry.js';
import { notesRepo } from '../../db/repositories/notes.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

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
      const category = categoriesRepo.getByName(userId, String(args.category));
      if (!category) return `No tienes ninguna categoría llamada "${args.category}".`;
      categoryId = category.id;
    }

    const notes = args.search ? notesRepo.search(userId, String(args.search), categoryId) : notesRepo.listByCategory(userId, categoryId);
    if (notes.length === 0) return 'No tienes notas que coincidan.';
    return notesView(notes, categoriesRepo.listAll(userId), { filter: args.search ? `"${String(args.search)}"` : undefined });
  },
};
