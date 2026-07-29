import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const saveLinkTool: Tool = {
  name: 'save_link',
  description:
    'Guarda un link ya clasificado. Solo úsala después de: 1) mostrar list_categories y que el usuario elija una ' +
    'categoría EXISTENTE (o confirme explícitamente crear una nueva con create_category), y 2) tener una breve ' +
    'descripción. La categoría debe existir ya - esta tool NO crea categorías nuevas por su cuenta, para evitar ' +
    'que queden categorías inventadas o mal escritas que el usuario nunca pidió.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'La URL a guardar.' },
      category: { type: 'string', description: 'Nombre EXACTO de una categoría que ya existe (ver list_categories).' },
      description: { type: 'string', description: 'Breve descripción de qué es el link.' },
      title: { type: 'string', description: 'Título corto opcional.' },
    },
    required: ['url', 'category'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const url = String(args.url ?? '').trim();
    if (!url) return 'Error: falta la URL.';
    const categoryName = String(args.category ?? '').trim();
    if (!categoryName) return 'Error: falta la categoría.';

    const category = categoriesRepo.getByName(ctx.userId, categoryName);
    if (!category) {
      return (
        `Error: la categoría "${categoryName}" no existe todavía. Usa list_categories para mostrarme las ` +
        'categorías reales y preguntarme en cuál, o create_category si confirmo crear una nueva - no la inventes tú.'
      );
    }
    const id = linksRepo.create(ctx.userId, {
      url,
      categoryId: category.id,
      title: args.title ? String(args.title) : null,
      description: args.description ? String(args.description) : null,
    });
    return `Link guardado (#${id}) en la categoría "${category.name}".`;
  },
};
