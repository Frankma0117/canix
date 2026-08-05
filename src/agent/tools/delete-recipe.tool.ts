import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';

export const deleteRecipeTool: Tool = {
  name: 'delete_recipe',
  description: 'Elimina una receta guardada por su id.',
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
    recipesRepo.remove(ctx.userId, id);
    return `Receta #${id} "${recipe.title}" eliminada.`;
  },
};
