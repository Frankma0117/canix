import type { Tool } from '../tool-registry.js';
import { mealPlansRepo } from '../../db/repositories/meal-plans.repo.js';
import { todayLocal, normalizeDate } from '../../util/datetime.js';

export const listMealPlanTool: Tool = {
  name: 'list_meal_plan',
  description: 'Lista el plan de comidas programado en un rango de fechas (default: hoy).',
  parameters: {
    type: 'object',
    properties: {
      from_date: { type: 'string', description: "Fecha inicial 'YYYY-MM-DD'. Default hoy." },
      to_date: { type: 'string', description: "Fecha final 'YYYY-MM-DD'. Default igual a from_date." },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const from = args.from_date ? normalizeDate(String(args.from_date)).slice(0, 10) : todayLocal();
    const to = args.to_date ? normalizeDate(String(args.to_date)).slice(0, 10) : from;

    const plans = mealPlansRepo.listRange(ctx.userId, from, to);
    if (plans.length === 0) return `No hay nada planeado entre ${from} y ${to}.`;
    return plans.map((p) => `#${p.id} ${p.plan_date} ${p.meal_slot}: ${p.title}${p.notes ? ` (${p.notes})` : ''}`).join('\n');
  },
};
