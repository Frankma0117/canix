import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';

export const getRecipeTool: Tool = {
  name: 'get_recipe',
  description: 'Muestra una receta guardada completa (ingredientes e instrucciones) por su id.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id de la receta (ver list_recipes).' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const recipe = recipesRepo.getById(ctx.userId, id);
    if (!recipe) return `No encontré la receta #${id}.`;
    return `${recipe.title}\n\nIngredientes:\n${recipe.ingredients}\n\nPreparación:\n${recipe.instructions}`;
  },
};
