import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteRoutineTool: Tool = {
  name: 'delete_routine',
  description:
    'Elimina una rutina/hábito por su id, junto con su historial y sus recordatorios de aviso/chequeo asociados.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU rutina en vez de la tuya.',
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
    if (!todo || todo.scope !== 'routine') return `No encontré la rutina #${id}.`;
    todosRepo.remove(userId, id); // cascades: habit_logs, reminders (kind routine_*), rewards_punishments.todo_id -> null
    return `Listo, borré la rutina "${todo.title}" junto con su historial y recordatorios.`;
  },
};
