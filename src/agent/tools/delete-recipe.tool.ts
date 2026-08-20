import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteRecipeTool: Tool = {
  name: 'delete_recipe',
  description: 'Elimina una receta guardada por su id.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la receta (ver list_recipes).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU receta en vez de la tuya.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const id = Number(args.id);
    const recipe = recipesRepo.getById(userId, id);
    if (!recipe) return `No encontré la receta #${id}.`;
    recipesRepo.remove(userId, id);
    return `Listo, borré la receta #${id} "${recipe.title}".`;
  },
};
