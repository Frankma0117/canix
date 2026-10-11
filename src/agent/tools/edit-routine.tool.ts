import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { updateRoutineWithReminders, parseScheduleInput, isValidTime } from '../routine-setup.js';
import { describeSchedule, scheduleOf } from '../routine-schedule.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const editRoutineTool: Tool = {
  name: 'edit_routine',
  description:
    'Edita una rutina/hábito existente (título, categoría, frecuencia/días, hora de aviso y/o duración) sin borrarla y ' +
    'recrearla - conserva su historial y racha. Útil también para "reprogramar" una rutina a otro horario el mismo ' +
    'día (ej. la hizo tarde, o quiere moverla a la tarde). Solo cambia los campos que mandes.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      title: { type: 'string', description: 'Nuevo nombre (opcional).' },
      category: { type: 'string', description: 'Nueva categoría (opcional).' },
      frequency: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly'],
        description:
          '"daily" = todos los días (o cada N días con interval); "weekly" = ciertos días de la semana (weekdays); ' +
          '"monthly" = un día del mes (month_day). Opcional.',
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
      reminder_time: { type: 'string', description: "Nueva hora de aviso 'HH:mm' (opcional)." },
      duration_minutes: { type: 'number', description: 'Nueva duración en minutos (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU rutina en vez de la tuya.',
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

    let categoryId: number | null | undefined;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    let reminderTime: string | undefined;
    if (args.reminder_time !== undefined) {
      reminderTime = String(args.reminder_time);
      if (!isValidTime(reminderTime)) return "La hora tiene que ir en formato 'HH:mm'.";
    }

    let durationMinutes: number | undefined;
    if (args.duration_minutes !== undefined) {
      durationMinutes = Number(args.duration_minutes);
      if (!durationMinutes || durationMinutes <= 0) return 'La duración tiene que ser un número mayor a 0.';
    }

    const schedule = parseScheduleInput(args);
    if ('error' in schedule) return schedule.error;

    const ok = updateRoutineWithReminders(userId, id, {
      title: args.title ? String(args.title) : undefined,
      categoryId,
      reminderTime,
      durationMinutes,
      ...schedule,
    });
    if (!ok) return `No encontré la rutina #${id}.`;

    const updated = todosRepo.getById(userId, id)!;
    return `Listo, actualicé la rutina #${id} "${updated.title}" 👍 Ahora es ${describeSchedule(scheduleOf(updated))} a las ${updated.reminder_time}.`;
  },
};
