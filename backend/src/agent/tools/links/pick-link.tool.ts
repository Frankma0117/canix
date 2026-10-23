import { linkCard } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { linksModel } from '../../../models/links.model.js';
import { categoriesModel } from '../../../models/categories.model.js';

export const pickLinkTool: Tool = {
  name: 'pick_link',
  description:
    'Sugiere un link al azar de una categoría (ej. "dame algo de comidas para hoy"). Prioriza links usados menos recientemente. Devuelve el link ya diseñado: envíalo TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de la categoría de la que sugerir algo.' },
    },
    required: ['category'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const category = categoriesModel.getByName(ctx.userId, String(args.category ?? ''));
    if (!category) return `No tienes ninguna categoría llamada "${args.category}".`;

    const link = linksModel.pickRandom(ctx.userId, category.id);
    if (!link) return `Todavía no tienes links guardados en "${category.name}".`;

    linksModel.markUsed(ctx.userId, link.id);
    return linkCard(link, category.name);
  },
};
