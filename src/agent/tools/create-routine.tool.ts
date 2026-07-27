import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { createRoutineWithReminders } from '../routine-setup.js';
import type { RecurrenceFreq } from '../../types/index.js';

const TIME_RE = /^\d{1,2}:\d{2}$/;

export const createRoutineTool: Tool = {
  name: 'create_routine',
  description:
    'Crea un hábito/rutina recurrente para hacerle seguimiento diario o semanal (ej. "ejercicio", "leer 20 minutos"). ' +
    'Toda rutina necesita una hora de recordatorio y una duración: el bot avisa a esa hora y, al terminar la duración, ' +
    'pregunta si se cumplió (ej. "leer a las 8, 30 minutos" -> avisa a las 8:00 y pregunta a las 8:30).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nombre del hábito/rutina.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      frequency: {
        type: 'string',
        enum: ['daily', 'weekly'],
        description: 'Con qué frecuencia se espera hacerlo. Default "daily".',
      },
      reminder_time: { type: 'string', description: "Hora a la que avisar, 'HH:mm' (ej. '20:00' para 8pm)." },
      duration_minutes: {
        type: 'number',
        description: 'Minutos que dura. Al pasar este tiempo desde reminder_time, el bot pregunta si se cumplió.',
      },
    },
    required: ['title', 'reminder_time', 'duration_minutes'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const title = String(args.title ?? '').trim();
    if (!title) return 'Error: falta el nombre de la rutina.';

    const reminderTime = String(args.reminder_time ?? '');
    if (!TIME_RE.test(reminderTime)) return "Error: reminder_time debe ser una hora en formato 'HH:mm'.";

    const durationMinutes = Number(args.duration_minutes);
    if (!durationMinutes || durationMinutes <= 0) return 'Error: duration_minutes debe ser un número mayor a 0.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    const freq: RecurrenceFreq = args.frequency === 'weekly' ? 'weekly' : 'daily';
    const id = createRoutineWithReminders(ctx.userId, ctx.ownerJid, {
      title,
      categoryId,
      freq,
      reminderTime,
      durationMinutes,
    });

    return (
      `Rutina #${id} "${title}" creada (${freq === 'daily' ? 'diaria' : 'semanal'}): ` +
      `aviso a las ${reminderTime}, chequeo ${durationMinutes} min después. Usa checkin_routine para marcar avances.`
    );
  },
};
