import type { Tool } from '../../tool-registry.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { todosModel } from '../../../models/todos.model.js';
import { createRoutineWithReminders, parseScheduleInput, isValidTime } from '../../../services/routines/routine-setup.service.js';
import { describeSchedule, scheduleOf } from '../../../services/routines/routine-schedule.js';
import { WORKOUT_KINDS, guessWorkoutKind, isWorkoutKind } from '../../../services/workouts/workouts.service.js';
import { relatedLinks } from '../../../services/search/related.service.js';
import { internalRef } from '../../../shared/utils/wa-format.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { SCHEDULE_PARAMS } from './shared.js';

export const addWorkoutTool: Tool = {
  name: 'add_workout',
  description:
    'Agrega a EJERCICIOS una actividad física con su horario: boxeo, zumba, gym, pesas, correr, caminar, bici, spinning, ' +
    'yoga, pilates, natación, fútbol, cualquier deporte o clase. Le aviso a su hora y se marca con 👍/👎; lleva sesiones y ' +
    'minutos de la semana y racha. Ej: "boxeo los lunes y miércoles a las 7pm, 1 hora, en el gimnasio Body" -> title "Boxeo", ' +
    'kind combat, frequency weekly, weekdays [lunes, miercoles], reminder_time 19:00, duration_minutes 60, place "Gimnasio ' +
    'Body". Úsala EN VEZ de create_routine para cualquier ejercicio. El desglose (series, rounds) va después con add_exercise.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nombre ("Boxeo", "Zumba", "Gym - pierna", "Correr").' },
      kind: {
        type: 'string',
        enum: Object.keys(WORKOUT_KINDS),
        description: 'combat = boxeo/kick/artes marciales; dance = zumba/baile; strength = gym/pesas/crossfit; cardio = correr/bici/spinning/caminar; flexibility = yoga/pilates/estiramiento; sport = fútbol/natación/tenis...; other.',
      },
      ...SCHEDULE_PARAMS,
      reminder_time: { type: 'string', description: "Hora de la clase o de empezar, 'HH:mm'." },
      duration_minutes: { type: 'number', description: 'Cuánto dura en minutos (1 hora = 60).' },
      place: { type: 'string', description: 'Dónde (gimnasio, parque, academia, casa). Opcional.' },
      notes: { type: 'string', description: 'Notas (profesor, qué llevar, objetivo). Opcional.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    required: ['title', 'reminder_time', 'duration_minutes'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const title = String(args.title ?? '').trim();
    if (!title) return 'Me falta el nombre del ejercicio.';
    const reminderTime = String(args.reminder_time ?? '');
    if (!isValidTime(reminderTime)) return "La hora tiene que ir en formato 'HH:mm'.";
    const durationMinutes = Number(args.duration_minutes);
    if (!durationMinutes || durationMinutes <= 0) return 'La duración tiene que ser un número mayor a 0.';
    const schedule = parseScheduleInput(args);
    if ('error' in schedule) return schedule.error;
    if (schedule.freq === 'weekly' && !schedule.weekdays?.length) return 'Necesito saber qué día(s) de la semana - pregúntaselo antes de crearlo.';

    const kind = isWorkoutKind(args.kind) ? args.kind : (guessWorkoutKind(title) ?? 'other');
    const id = createRoutineWithReminders(userId, targetJid, {
      title,
      categoryId: args.category ? categoriesModel.findOrCreate(userId, String(args.category)).id : null,
      reminderTime,
      durationMinutes,
      workoutKind: kind,
      place: args.place ? String(args.place).trim() : null,
      notes: args.notes ? String(args.notes).trim() : null,
      ...schedule,
    });
    const created = todosModel.getById(userId, id)!;

    // A class video, a playlist... already saved for this - offered right away.
    const related = relatedLinks(userId, title);
    const relatedNote = related.length
      ? ` Tiene guardados estos links relacionados, sugiéreselos (título + url):\n${related.map((l) => `- ${l.title || l.description || 'Link'} ${l.url}`).join('\n')}`
      : '';
    return (
      `Listo, agregué a Ejercicios ${WORKOUT_KINDS[kind].emoji} "${title}" ${internalRef(id)} (${describeSchedule(scheduleOf(created))}, ` +
      `${reminderTime}, ${durationMinutes} min${created.place ? `, en ${created.place}` : ''}). A esa hora le aviso y lo marca con 👍/👎. ` +
      'Ofrécele agregar los ejercicios (rounds, series) con add_exercise si aplica.' +
      relatedNote
    );
  },
};
