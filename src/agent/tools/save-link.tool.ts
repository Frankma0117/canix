import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const saveLinkTool: Tool = {
  name: 'save_link',
  description:
    'Guarda un link ya clasificado. Solo úsala después de confirmar la categoría y pedir una descripción; no la llames apenas veas una URL.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'La URL a guardar.' },
      category: { type: 'string', description: 'Nombre de la categoría (se crea si no existe).' },
      description: { type: 'string', description: 'Breve descripción de qué es el link.' },
      title: { type: 'string', description: 'Título corto opcional.' },
    },
    required: ['url', 'category'],
    additionalProperties: false,
  },

  async execute(args) {
    const url = String(args.url ?? '').trim();
    if (!url) return 'Error: falta la URL.';
    const categoryName = String(args.category ?? '').trim();
    if (!categoryName) return 'Error: falta la categoría.';

    const category = categoriesRepo.findOrCreate(categoryName);
    const id = linksRepo.create({
      url,
      categoryId: category.id,
      title: args.title ? String(args.title) : null,
      description: args.description ? String(args.description) : null,
    });
    return `Link guardado (#${id}) en la categoría "${category.name}".`;
  },
};
