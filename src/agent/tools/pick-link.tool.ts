import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const pickLinkTool: Tool = {
  name: 'pick_link',
  description:
    'Sugiere un link al azar de una categoría (ej. "dame algo de comidas para hoy"). Prioriza links usados menos recientemente.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de la categoría de la que sugerir algo.' },
    },
    required: ['category'],
    additionalProperties: false,
  },

  async execute(args) {
    const category = categoriesRepo.getByName(String(args.category ?? ''));
    if (!category) return `No existe la categoría "${args.category}".`;

    const link = linksRepo.pickRandom(category.id);
    if (!link) return `No hay links guardados todavía en "${category.name}".`;

    linksRepo.markUsed(link.id);
    const label = link.title || link.description || '';
    return `De "${category.name}": ${label ? `${label} — ` : ''}${link.url} (#${link.id})`;
  },
};
