import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';

export const completeTodoTool: Tool = {
  name: 'complete_todo',
  description: 'Marca una tarea (o pendiente de hoy) como hecha, por su id.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id de la tarea.' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args) {
    const id = Number(args.id);
    const todo = todosRepo.getById(id);
    if (!todo) return `No encontré la tarea #${id}.`;
    todosRepo.complete(id);
    return `Tarea #${id} "${todo.title}" marcada como hecha. 🎉`;
  },
};
