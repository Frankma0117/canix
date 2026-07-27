import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { habitLogsRepo } from '../../db/repositories/habit-logs.repo.js';
import { todayLocal } from '../../util/datetime.js';

export const routineProgressTool: Tool = {
  name: 'routine_progress',
  description: 'Muestra el historial/racha reciente de una rutina (últimos N días).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina.' },
      days: { type: 'number', description: 'Cuántos días de historial mostrar. Default 7.' },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args) {
    const id = Number(args.id);
    const todo = todosRepo.getById(id);
    if (!todo || todo.scope !== 'routine') return `No encontré la rutina #${id}.`;

    const days = Number(args.days) > 0 ? Number(args.days) : 7;
    const history = habitLogsRepo.history(id, days);
    const streak = habitLogsRepo.currentStreak(id, todayLocal());

    const historyText = history.length
      ? history.map((h) => `${h.log_date}: ${h.done ? '✅' : '❌'}${h.note ? ` (${h.note})` : ''}`).join('\n')
      : '(Sin registros todavía.)';

    return `Rutina "${todo.title}" — racha actual: ${streak} día(s).\n${historyText}`;
  },
};
