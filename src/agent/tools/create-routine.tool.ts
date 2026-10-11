import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { createRoutineWithReminders, parseScheduleInput, isValidTime } from '../routine-setup.js';
import { describeSchedule, scheduleOf } from '../routine-schedule.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const createRoutineTool: Tool = {
  name: 'create_routine',
  description:
    'Crea un hábito/rutina recurrente (ej. "ejercicio", "leer 20 minutos") para hacerle seguimiento: todos los días, ' +
    'ciertos días de la semana, cada 15 días o cada mes. Toda rutina necesita una hora de aviso y una duración: el bot ' +
    'avisa a esa hora con una encuesta de Sí/No para marcarla cuando se termine.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nombre del hábito/rutina.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      frequency: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly'],
        description:
          '"daily" = todos los días (o cada N días con interval); "weekly" = ciertos días de la semana (weekdays); ' +
          '"monthly" = un día del mes (month_day). Default "daily".',
      },
      weekdays: {
        type: 'array',
        items: { type: 'string', enum: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] },
        description: 'Solo con frequency "weekly": qué días se hace (ej. ["lunes","miercoles","viernes"]).',
      },
      interval: {
        type: 'number',
        description:
          'Cada cuántos días/semanas/meses. "Cada 15 días" o "quincenal" = frequency "weekly" con interval 2. Default 1.',
      },
      month_day: { type: 'number', description: 'Solo con frequency "monthly": día del mes (1-31).' },
      start_date: { type: 'string', description: "Opcional: fecha 'YYYY-MM-DD' desde la que empieza (default: su próxima ocurrencia)." },
      reminder_time: { type: 'string', description: "Hora a la que avisar, 'HH:mm' (ej. '20:00' para 8pm)." },
      duration_minutes: { type: 'number', description: 'Minutos que dura.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para crearle la rutina a ella en vez de a ti.',
      },
    },
    required: ['title', 'reminder_time', 'duration_minutes'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const title = String(args.title ?? '').trim();
    if (!title) return 'Me falta el nombre de la rutina.';

    const reminderTime = String(args.reminder_time ?? '');
    if (!isValidTime(reminderTime)) return "La hora tiene que ir en formato 'HH:mm'.";

    const durationMinutes = Number(args.duration_minutes);
    if (!durationMinutes || durationMinutes <= 0) return 'La duración tiene que ser un número mayor a 0.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    const schedule = parseScheduleInput(args);
    if ('error' in schedule) return schedule.error;
    if (schedule.freq === 'weekly' && !schedule.weekdays?.length) {
      return 'Para una rutina semanal necesito saber qué día(s) de la semana - pregúntaselo antes de crearla.';
    }

    const id = createRoutineWithReminders(userId, targetJid, { title, categoryId, reminderTime, durationMinutes, ...schedule });
    const created = todosRepo.getById(userId, id)!;

    return (
      `Listo, creé la rutina #${id} "${title}" (${describeSchedule(scheduleOf(created))}) 👍 ` +
      `Aviso a las ${reminderTime} (${durationMinutes} min), empieza el ${created.start_date}. ` +
      'El aviso llega con una encuesta de Sí/No para marcarla; también se puede marcar con checkin_routine.'
    );
  },
};
