import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';

export const listRecipesTool: Tool = {
  name: 'list_recipes',
  description: 'Lista las recetas guardadas.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    const recipes = recipesRepo.listAll(ctx.userId);
    if (recipes.length === 0) return 'No hay recetas guardadas todavía.';
    return recipes.map((r) => `#${r.id} ${r.title} — ingredientes: ${r.ingredients}`).join('\n');
  },
};
