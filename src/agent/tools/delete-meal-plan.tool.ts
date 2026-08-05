import type { Tool } from '../tool-registry.js';
import { mealPlansRepo } from '../../db/repositories/meal-plans.repo.js';

export const deleteMealPlanTool: Tool = {
  name: 'delete_meal_plan',
  description: 'Elimina algo planeado del plan de comidas por su id.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id del plan (ver list_meal_plan).' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const plan = mealPlansRepo.getById(ctx.userId, id);
    if (!plan) return `No encontré el plan #${id}.`;
    mealPlansRepo.remove(ctx.userId, id);
    return `Plan #${id} (${plan.meal_slot} del ${plan.plan_date}) eliminado.`;
  },
};
