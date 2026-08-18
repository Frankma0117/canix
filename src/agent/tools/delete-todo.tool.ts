import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteTodoTool: Tool = {
  name: 'delete_todo',
  description:
    'Elimina una tarea de "hoy" o "para después" por su id (cancela sin marcarla como hecha). Para editarla en vez ' +
    'de borrarla usa edit_todo. Para rutinas usa delete_routine, no esta.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la tarea.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU tarea en vez de la tuya.',
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
    const todo = todosRepo.getById(userId, id);
    if (!todo) return `No encontré la tarea #${id}.`;
    if (todo.scope === 'routine') return `#${id} "${todo.title}" es una rutina - usa delete_routine para eliminarla, no delete_todo.`;
    todosRepo.remove(userId, id);
    return `Tarea #${id} "${todo.title}" eliminada.`;
  },
};
