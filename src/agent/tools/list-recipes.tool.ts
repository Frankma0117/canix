import { recipesView } from '../views.js';
import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const listRecipesTool: Tool = {
  name: 'list_recipes',
  description: 'Lista las recetas guardadas. Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS recetas en vez de las tuyas.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const recipes = recipesRepo.listAll(acting.userId);
    if (recipes.length === 0) return 'Todavía no tienes recetas guardadas.';
    return recipesView(recipes);
  },
};
