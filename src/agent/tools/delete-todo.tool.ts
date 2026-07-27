import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';

export const deleteTodoTool: Tool = {
  name: 'delete_todo',
  description: 'Elimina una tarea pendiente por su id (cancela sin marcarla como hecha).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id de la tarea.' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const todo = todosRepo.getById(ctx.userId, id);
    if (!todo) return `No encontré la tarea #${id}.`;
    todosRepo.remove(ctx.userId, id);
    return `Tarea #${id} "${todo.title}" eliminada.`;
  },
};
