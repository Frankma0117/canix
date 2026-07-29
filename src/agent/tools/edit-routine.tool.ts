import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { updateRoutineWithReminders } from '../routine-setup.js';
import type { RecurrenceFreq } from '../../types/index.js';

const TIME_RE = /^\d{1,2}:\d{2}$/;

export const editRoutineTool: Tool = {
  name: 'edit_routine',
  description:
    'Edita una rutina/hábito existente (título, categoría, frecuencia, hora de aviso y/o duración) sin borrarla y ' +
    'recrearla - conserva su historial y racha. Útil también para "reprogramar" una rutina a otro horario el mismo ' +
    'día (ej. la hizo tarde, o quiere moverla a la tarde). Solo cambia los campos que mandes.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      title: { type: 'string', description: 'Nuevo nombre (opcional).' },
      category: { type: 'string', description: 'Nueva categoría (opcional).' },
      frequency: { type: 'string', enum: ['daily', 'weekly'], description: 'Nueva frecuencia (opcional).' },
      reminder_time: { type: 'string', description: "Nueva hora de aviso 'HH:mm' (opcional)." },
      duration_minutes: { type: 'number', description: 'Nueva duración en minutos (opcional).' },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);

    let categoryId: number | null | undefined;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    let reminderTime: string | undefined;
    if (args.reminder_time !== undefined) {
      reminderTime = String(args.reminder_time);
      if (!TIME_RE.test(reminderTime)) return "Error: reminder_time debe ser una hora en formato 'HH:mm'.";
    }

    let durationMinutes: number | undefined;
    if (args.duration_minutes !== undefined) {
      durationMinutes = Number(args.duration_minutes);
      if (!durationMinutes || durationMinutes <= 0) return 'Error: duration_minutes debe ser un número mayor a 0.';
    }

    const freq: RecurrenceFreq | undefined = args.frequency === 'weekly' ? 'weekly' : args.frequency === 'daily' ? 'daily' : undefined;

    const ok = updateRoutineWithReminders(ctx.userId, id, {
      title: args.title ? String(args.title) : undefined,
      categoryId,
      freq,
      reminderTime,
      durationMinutes,
    });
    if (!ok) return `No encontré la rutina #${id}.`;

    return `Rutina #${id} actualizada.`;
  },
};
