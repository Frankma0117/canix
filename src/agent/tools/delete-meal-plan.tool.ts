import type { Tool } from '../tool-registry.js';
import { mealPlansRepo } from '../../db/repositories/meal-plans.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteMealPlanTool: Tool = {
  name: 'delete_meal_plan',
  description: 'Elimina algo planeado del plan de comidas por su id.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del plan (ver list_meal_plan).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU plan en vez del tuyo.',
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
    const plan = mealPlansRepo.getById(userId, id);
    if (!plan) return `No encontré el plan #${id}.`;
    mealPlansRepo.remove(userId, id);
    return `Listo, borré el plan #${id} (${plan.meal_slot} del ${plan.plan_date}).`;
  },
};
