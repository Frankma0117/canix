import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';

export const completeTodoTool: Tool = {
  name: 'complete_todo',
  description:
    'Marca una tarea de "hoy" o "para después" como hecha, por su id. Para rutinas/hábitos usa checkin_routine ' +
    'en vez de esta - una rutina se repite cada día y no tiene sentido marcarla "done" para siempre.',
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
    if (todo.scope === 'routine') return `#${id} "${todo.title}" es una rutina - usa checkin_routine para marcarla, no complete_todo.`;
    todosRepo.complete(ctx.userId, id);
    return `Tarea #${id} "${todo.title}" marcada como hecha. 🎉`;
  },
};
