import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { moveRoutineToday } from '../routine-setup.js';
import { shortTime } from '../../util/wa-format.js';
import { resolveActingUser } from './act-on-behalf.js';

export const moveRoutineTodayTool: Tool = {
  name: 'move_routine_today',
  description:
    'Mueve SOLO el aviso de HOY de una rutina a otra hora ("hoy la hago a las 6", "reprográmala para más tarde", ' +
    '"pásala a la tarde"). La rutina conserva su hora de siempre: mañana vuelve a avisar a la hora normal. Es lo que ' +
    'se usa para reprogramar algo que se pasó hoy. Para cambiarle la hora a la rutina de forma permanente es edit_routine.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      time: { type: 'string', description: "Hora de HOY a la que debe avisar, 'HH:mm' en 24 h (ej. '18:00')." },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para mover SU rutina en vez de la tuya.',
      },
    },
    required: ['id', 'time'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const id = Number(args.id);
    const moved = moveRoutineToday(userId, id, String(args.time ?? ''));
    if ('error' in moved) return moved.error;
    const todo = todosRepo.getById(userId, id)!;
    return `Listo: hoy "${todo.title}" avisa a las ${shortTime(moved.runAt)}. Mañana vuelve a su hora de siempre (${shortTime(todo.reminder_time ?? '')}).`;
  },
};
