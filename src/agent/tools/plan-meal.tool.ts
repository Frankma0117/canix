import type { Tool } from '../tool-registry.js';
import { mealPlansRepo } from '../../db/repositories/meal-plans.repo.js';
import { normalizeDate } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { MealSlot } from '../../types/index.js';

const SLOTS: MealSlot[] = ['desayuno', 'almuerzo', 'cena', 'onces'];

export const planMealTool: Tool = {
  name: 'plan_meal',
  description:
    'Programa qué comer en una fecha y comida específica (desayuno, almuerzo, cena u onces). Para planear varios días ' +
    'o varias comidas, llama esta tool una vez por cada fecha+comida.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: "Fecha 'YYYY-MM-DD'." },
      meal_slot: { type: 'string', enum: SLOTS, description: 'Cuál comida.' },
      title: { type: 'string', description: 'Qué comer (ej. "arroz con pollo y ensalada").' },
      notes: { type: 'string', description: 'Notas opcionales (ej. cantidades, receta a seguir).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para planeárselo a ella en vez de a ti.',
      },
    },
    required: ['date', 'meal_slot', 'title'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const date = normalizeDate(String(args.date ?? '')).slice(0, 10);
    const mealSlot = SLOTS.includes(args.meal_slot as MealSlot) ? (args.meal_slot as MealSlot) : null;
    if (!mealSlot) return `meal_slot tiene que ser uno de: ${SLOTS.join(', ')}.`;

    const title = String(args.title ?? '').trim();
    if (!title) return 'Me falta qué vas a comer.';

    const id = mealPlansRepo.create(userId, { planDate: date, mealSlot, title, notes: args.notes ? String(args.notes) : null });
    return `Listo, guardé el plan #${id}: ${mealSlot} del ${date} — ${title}.`;
  },
};
