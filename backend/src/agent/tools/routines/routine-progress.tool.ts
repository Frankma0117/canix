import { routineStreak, describeSchedule, scheduleOf } from '../../../services/routines/routine-schedule.js';
import type { Tool } from '../../tool-registry.js';
import { todosModel } from '../../../models/todos.model.js';
import { habitLogsModel } from '../../../models/habit-logs.model.js';
import { todayLocal } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const routineProgressTool: Tool = {
  name: 'routine_progress',
  description: 'Muestra el historial/racha reciente de una rutina (últimos N días).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina.' },
      days: { type: 'number', description: 'Cuántos días de historial mostrar. Default 7.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SU rutina en vez de la tuya.',
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
    const todo = todosModel.getById(userId, id);
    if (!todo || todo.scope !== 'routine') return `No encontré la rutina ⟦${id}⟧.`;

    const days = Number(args.days) > 0 ? Number(args.days) : 7;
    const history = habitLogsModel.history(id, days);
    const streak = routineStreak(todo, todayLocal());

    const historyText = history.length
      ? history.map((h) => `${h.log_date}: ${h.done ? '✅' : '❌'}${h.note ? ` (${h.note})` : ''}`).join('\n')
      : '(Sin registros todavía.)';

    return `Rutina "${todo.title}" (${describeSchedule(scheduleOf(todo))}) — racha actual: ${streak}.\n${historyText}`;
  },
};
