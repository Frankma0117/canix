import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';

export const deleteRoutineTool: Tool = {
  name: 'delete_routine',
  description:
    'Elimina una rutina/hábito por su id, junto con su historial y sus recordatorios de aviso/chequeo asociados.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const todo = todosRepo.getById(ctx.userId, id);
    if (!todo || todo.scope !== 'routine') return `No encontré la rutina #${id}.`;
    todosRepo.remove(ctx.userId, id); // cascades: habit_logs, reminders (kind routine_*), rewards_punishments.todo_id -> null
    return `Rutina "${todo.title}" eliminada, junto con su historial y recordatorios.`;
  },
};
