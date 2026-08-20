import type { Tool } from '../tool-registry.js';
import { mealPlansRepo } from '../../db/repositories/meal-plans.repo.js';
import { normalizeDate } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { MealSlot } from '../../types/index.js';

const SLOTS: MealSlot[] = ['desayuno', 'almuerzo', 'cena', 'onces'];

export const editMealPlanTool: Tool = {
  name: 'edit_meal_plan',
  description: 'Edita un plan de comida ya guardado (fecha, comida, qué comer y/o notas) sin borrarlo y crear uno nuevo.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del plan de comida (ver list_meal_plan).' },
      date: { type: 'string', description: "Nueva fecha 'YYYY-MM-DD' (opcional)." },
      meal_slot: { type: 'string', enum: SLOTS, description: 'Nueva comida (opcional).' },
      title: { type: 'string', description: 'Nuevo qué comer (opcional).' },
      notes: { type: 'string', description: 'Nuevas notas (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU plan en vez del tuyo.',
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

    let mealSlot: MealSlot | undefined;
    if (args.meal_slot !== undefined) {
      if (!SLOTS.includes(args.meal_slot as MealSlot)) return `meal_slot tiene que ser uno de: ${SLOTS.join(', ')}.`;
      mealSlot = args.meal_slot as MealSlot;
    }

    mealPlansRepo.update(userId, id, {
      planDate: args.date ? normalizeDate(String(args.date)).slice(0, 10) : undefined,
      mealSlot,
      title: args.title ? String(args.title) : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
    });

    const updated = mealPlansRepo.getById(userId, id)!;
    return `Listo, actualicé el plan #${id}: ${updated.meal_slot} del ${updated.plan_date} — ${updated.title}.`;
  },
};
