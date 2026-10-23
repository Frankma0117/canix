import type { Tool } from '../../tool-registry.js';
import { todosModel } from '../../../models/todos.model.js';
import { updateRoutineWithReminders, parseScheduleInput, isValidTime } from '../../../services/routines/routine-setup.service.js';
import { describeSchedule, scheduleOf } from '../../../services/routines/routine-schedule.js';
import { WORKOUT_KINDS, isWorkoutKind } from '../../../services/workouts/workouts.service.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { SCHEDULE_PARAMS, resolveWorkout } from './shared.js';

export const editWorkoutTool: Tool = {
  name: 'edit_workout',
  description:
    'Cambia un ejercicio de EJERCICIOS (nombre, tipo, días, hora, duración, lugar, notas) sin perder su racha ni historial. ' +
    'Cambiar reminder_time aquí es PARA SIEMPRE: solo por hoy = move_routine_today. Pausar = pause_routine, borrar = ' +
    'delete_routine, marcarlo hecho = checkin_routine. Solo cambia lo que mandes.',
  parameters: {
    type: 'object',
    properties: {
      workout: { type: 'string', description: 'Cuál (nombre o marca ⟦id⟧).' },
      title: { type: 'string', description: 'Nuevo nombre.' },
      kind: { type: 'string', enum: Object.keys(WORKOUT_KINDS), description: 'Nuevo tipo.' },
      ...SCHEDULE_PARAMS,
      reminder_time: { type: 'string', description: "Nueva hora 'HH:mm'." },
      duration_minutes: { type: 'number', description: 'Nueva duración en minutos.' },
      place: { type: 'string', description: 'Nuevo lugar ("" para quitarlo).' },
      notes: { type: 'string', description: 'Nuevas notas ("" para quitarlas).' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    required: ['workout'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;
    const workout = resolveWorkout(userId, String(args.workout ?? ''));
    if ('error' in workout) return workout.error;

    if (args.reminder_time !== undefined && !isValidTime(String(args.reminder_time))) return "La hora tiene que ir en formato 'HH:mm'.";
    if (args.duration_minutes !== undefined && !(Number(args.duration_minutes) > 0)) return 'La duración tiene que ser un número mayor a 0.';
    const schedule = parseScheduleInput(args);
    if ('error' in schedule) return schedule.error;

    updateRoutineWithReminders(userId, workout.id, {
      title: args.title ? String(args.title).trim() : undefined,
      reminderTime: args.reminder_time !== undefined ? String(args.reminder_time) : undefined,
      durationMinutes: args.duration_minutes !== undefined ? Number(args.duration_minutes) : undefined,
      ...schedule,
    });
    const text = (v: unknown) => (v === undefined ? undefined : String(v).trim() || null);
    todosModel.setWorkout(userId, workout.id, { kind: isWorkoutKind(args.kind) ? args.kind : undefined, place: text(args.place), notes: text(args.notes) });

    const updated = todosModel.getById(userId, workout.id)!;
    return `Listo, actualicé "${updated.title}" 👍 Ahora es ${describeSchedule(scheduleOf(updated))} a las ${updated.reminder_time}, ${updated.duration_minutes} min${updated.place ? `, en ${updated.place}` : ''}.`;
  },
};
