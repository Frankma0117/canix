import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

function formatLink(l: { id: number; url: string; title: string | null; description: string | null }): string {
  const label = l.title || l.description || l.url;
  return `#${l.id} ${label}${l.title || l.description ? ` — ${l.url}` : ''}`;
}

export const listLinksTool: Tool = {
  name: 'list_links',
  description:
    'Lista los links guardados, opcionalmente filtrando por categoría o por un texto de búsqueda.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
      search: { type: 'string', description: 'Texto a buscar en url/título/descripción (opcional).' },
    },
    additionalProperties: false,
  },

  async execute(args) {
    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesRepo.getByName(String(args.category));
      if (!category) return `No existe la categoría "${args.category}".`;
      categoryId = category.id;
    }

    const links = args.search
      ? linksRepo.search(String(args.search), categoryId)
      : linksRepo.listByCategory(categoryId);

    if (links.length === 0) return 'No hay links que coincidan.';
    return links.map(formatLink).join('\n');
  },
};
