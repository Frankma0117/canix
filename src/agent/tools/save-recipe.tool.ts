import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const saveRecipeTool: Tool = {
  name: 'save_recipe',
  description:
    'Guarda una receta para consultarla después. Úsala cuando el usuario pida guardar una receta que le sugeriste ' +
    '(a partir de ingredientes que dio) o una que te pasó él mismo - no guardes nada sin que lo pida explícitamente.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nombre del plato.' },
      ingredients: { type: 'string', description: 'Lista de ingredientes.' },
      instructions: { type: 'string', description: 'Pasos para prepararlo.' },
      category: { type: 'string', description: 'Categoría opcional.' },
    },
    required: ['title', 'ingredients', 'instructions'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const title = String(args.title ?? '').trim();
    const ingredients = String(args.ingredients ?? '').trim();
    const instructions = String(args.instructions ?? '').trim();
    if (!title || !ingredients || !instructions) return 'Error: falta título, ingredientes o instrucciones.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    const id = recipesRepo.create(ctx.userId, { title, ingredients, instructions, categoryId });
    return `Receta #${id} "${title}" guardada.`;
  },
};
