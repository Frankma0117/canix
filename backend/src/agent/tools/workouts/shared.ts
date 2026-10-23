import { todosModel } from '../../../models/todos.model.js';
import { listWorkouts } from '../../../services/workouts/workouts.service.js';
import type { Todo } from '../../../entities/index.js';

/** When a workout happens - the same fields create_routine / edit_routine take. */
export const SCHEDULE_PARAMS = {
  frequency: {
    type: 'string',
    enum: ['daily', 'weekly', 'monthly'],
    description: '"daily" = todos los días (o cada N días con interval); "weekly" = ciertos días (weekdays); "monthly" = un día del mes (month_day).',
  },
  weekdays: {
    type: 'array',
    items: { type: 'string', enum: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] },
    description: 'Con frequency "weekly": qué días (ej. ["lunes","miercoles"]).',
  },
  interval: { type: 'number', description: 'Cada cuántos días/semanas/meses ("cada 15 días" = weekly con interval 2). Default 1.' },
  month_day: { type: 'number', description: 'Con frequency "monthly": día del mes (1-31).' },
};

/** A workout named by the person (or by its internal ref): exactly one, or the reason why not. */
export function resolveWorkout(userId: number, query: string): Todo | { error: string } {
  const text = query.replace(/[⟦⟧#]/g, '').trim();
  if (!text) return { error: 'Me falta cuál ejercicio.' };
  if (/^\d+$/.test(text)) {
    const byId = todosModel.getById(userId, Number(text));
    if (byId?.workout_kind) return byId;
  }
  const all = listWorkouts(userId);
  const matches = all.filter((w) => w.title.toLowerCase().includes(text.toLowerCase()));
  const exact = matches.filter((w) => w.title.toLowerCase() === text.toLowerCase());
  const pick = exact.length === 1 ? exact : matches;
  if (pick.length === 1) return pick[0];
  if (pick.length === 0) return { error: `No encontré "${text}" en Ejercicios. Revisa con list_workouts.` };
  return { error: `Hay varios que coinciden: ${pick.map((w) => `"${w.title}"`).join(', ')}. ¿Cuál?` };
}
