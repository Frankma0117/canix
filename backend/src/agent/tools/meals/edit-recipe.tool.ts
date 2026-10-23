import type { Tool } from '../../tool-registry.js';
import { recipesModel } from '../../../models/recipes.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const editRecipeTool: Tool = {
  name: 'edit_recipe',
  description: 'Edita una receta ya guardada (título, ingredientes, instrucciones y/o categoría) sin borrarla y crear una nueva.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la receta (ver list_recipes).' },
      title: { type: 'string', description: 'Nuevo título (opcional).' },
      ingredients: { type: 'string', description: 'Nuevos ingredientes (opcional).' },
      instructions: { type: 'string', description: 'Nuevas instrucciones (opcional).' },
      category: { type: 'string', description: 'Nueva categoría (opcional, se crea si no existe).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU receta en vez de la tuya.',
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
    const recipe = recipesModel.getById(userId, id);
    if (!recipe) return `No encontré la receta ⟦${id}⟧.`;

    let categoryId: number | undefined;
    if (args.category) categoryId = categoriesModel.findOrCreate(userId, String(args.category)).id;

    recipesModel.update(userId, id, {
      title: args.title ? String(args.title) : undefined,
      ingredients: args.ingredients ? String(args.ingredients) : undefined,
      instructions: args.instructions ? String(args.instructions) : undefined,
      categoryId,
    });

    const updated = recipesModel.getById(userId, id)!;
    return `Listo, actualicé la receta ⟦${id}⟧ "${updated.title}".`;
  },
};
