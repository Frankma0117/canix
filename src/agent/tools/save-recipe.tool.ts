import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

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
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para guardársela a ella en vez de a ti.',
      },
    },
    required: ['title', 'ingredients', 'instructions'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const title = String(args.title ?? '').trim();
    const ingredients = String(args.ingredients ?? '').trim();
    const instructions = String(args.instructions ?? '').trim();
    if (!title || !ingredients || !instructions) return 'Me falta el título, los ingredientes o las instrucciones.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    const id = recipesRepo.create(userId, { title, ingredients, instructions, categoryId });
    return `Listo, guardé la receta #${id} "${title}".`;
  },
};
