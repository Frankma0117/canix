import type { Tool } from '../../tool-registry.js';
import { mealPlansModel } from '../../../models/meal-plans.model.js';
import { normalizeDate } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { DEFAULT_MEAL_TIMES, syncMealReminders } from '../../../services/meals/meal-reminders.service.js';
import { normalizeTimes } from '../../../shared/utils/clock-times.js';
import type { MealSlot } from '../../../entities/index.js';

const SLOTS: MealSlot[] = ['desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena'];

export const planMealTool: Tool = {
  name: 'plan_meal',
  description:
    'Programa qué comer en una fecha y comida específica (desayuno, onces, almuerzo, media_tarde o cena). Con hora (time) o ' +
    'remind=true le aviso a esa hora "es hora de almorzar"; con prep_minutes también le aviso antes que toca prepararla. Para ' +
    'planear varios días o varias comidas, llama esta tool una vez por cada fecha+comida.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: "Fecha 'YYYY-MM-DD'." },
      meal_slot: { type: 'string', enum: SLOTS, description: 'Cuál comida.' },
      title: { type: 'string', description: 'Qué comer (ej. "arroz con pollo y ensalada").' },
      notes: { type: 'string', description: 'Notas opcionales (ej. cantidades, receta a seguir).' },
      time: { type: 'string', description: "Hora 'HH:mm' de esa comida: a esa hora le aviso que es hora de comer." },
      remind: { type: 'boolean', description: 'true si pidió que le avise y no dio hora: se usa la hora habitual de esa comida.' },
      prep_minutes: { type: 'number', description: 'Minutos antes de la comida para avisarle que toca prepararla (ej. 30).' },
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

    const mealTime = normalizeTimes([args.time])[0] ?? (args.remind === true || args.prep_minutes ? DEFAULT_MEAL_TIMES[mealSlot] : null);
    const prepMinutes = Number(args.prep_minutes) > 0 ? Math.min(Math.round(Number(args.prep_minutes)), 600) : null;
    const id = mealPlansModel.create(userId, { planDate: date, mealSlot, title, notes: args.notes ? String(args.notes) : null, mealTime, prepMinutes });
    const notices = syncMealReminders(userId, id);
    const when = mealTime ? ` a las ${mealTime}${notices ? ` (te aviso${prepMinutes ? ` y ${prepMinutes} min antes para prepararla` : ''})` : ' (esa hora ya pasó, no hay aviso)'}` : '';
    return `Listo, guardé el plan ⟦${id}⟧: ${mealSlot} del ${date}${when} — ${title}.`;
  },
};
