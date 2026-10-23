import type { Tool } from '../../tool-registry.js';
import { mealPlansModel } from '../../../models/meal-plans.model.js';
import { normalizeDate } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { DEFAULT_MEAL_TIMES, syncMealReminders } from '../../../services/meals/meal-reminders.service.js';
import { normalizeTimes } from '../../../shared/utils/clock-times.js';
import type { MealSlot } from '../../../entities/index.js';

const SLOTS: MealSlot[] = ['desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena'];

export const editMealPlanTool: Tool = {
  name: 'edit_meal_plan',
  description: 'Edita un plan de comida ya guardado (fecha, comida, qué comer, notas, hora del aviso y aviso para prepararla) sin borrarlo y crear uno nuevo. Para quitar el aviso, time vacío.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del plan de comida (ver list_meal_plan).' },
      date: { type: 'string', description: "Nueva fecha 'YYYY-MM-DD' (opcional)." },
      meal_slot: { type: 'string', enum: SLOTS, description: 'Nueva comida (opcional).' },
      title: { type: 'string', description: 'Nuevo qué comer (opcional).' },
      notes: { type: 'string', description: 'Nuevas notas (opcional).' },
      time: { type: 'string', description: "Hora 'HH:mm' de esa comida: a esa hora le aviso que es hora de comer." },
      remind: { type: 'boolean', description: 'true si pidió que le avise y no dio hora: se usa la hora habitual de esa comida.' },
      prep_minutes: { type: 'number', description: 'Minutos antes de la comida para avisarle que toca prepararla (ej. 30).' },
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
    const plan = mealPlansModel.getById(userId, id);
    if (!plan) return `No encontré el plan ⟦${id}⟧.`;

    let mealSlot: MealSlot | undefined;
    if (args.meal_slot !== undefined) {
      if (!SLOTS.includes(args.meal_slot as MealSlot)) return `meal_slot tiene que ser uno de: ${SLOTS.join(', ')}.`;
      mealSlot = args.meal_slot as MealSlot;
    }

    mealPlansModel.update(userId, id, {
      planDate: args.date ? normalizeDate(String(args.date)).slice(0, 10) : undefined,
      mealSlot,
      title: args.title ? String(args.title) : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
      mealTime: args.time === undefined ? (args.remind === true && !plan.meal_time ? DEFAULT_MEAL_TIMES[mealSlot ?? plan.meal_slot] : undefined) : (normalizeTimes([args.time])[0] ?? null),
      prepMinutes: args.prep_minutes === undefined ? undefined : Number(args.prep_minutes) > 0 ? Math.min(Math.round(Number(args.prep_minutes)), 600) : null,
    });
    syncMealReminders(userId, id);

    const updated = mealPlansModel.getById(userId, id)!;
    return `Listo, actualicé el plan ⟦${id}⟧: ${updated.meal_slot} del ${updated.plan_date}${updated.meal_time ? ` a las ${updated.meal_time}` : ''} — ${updated.title}.`;
  },
};
