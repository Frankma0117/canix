import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { pickCelebrationSticker } from '../../util/stickers.js';
import { resolveActingUser } from './act-on-behalf.js';

export const completeTodoTool: Tool = {
  name: 'complete_todo',
  description:
    'Marca una tarea de "hoy" o "para después" como hecha, por su id. Para rutinas/hábitos usa checkin_routine ' +
    'en vez de esta - una rutina se repite cada día y no tiene sentido marcarla "done" para siempre.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la tarea.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para marcar SU tarea en vez de la tuya.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const id = Number(args.id);
    const todo = todosRepo.getById(userId, id);
    if (!todo) return `No encontré la tarea #${id}.`;
    if (todo.scope === 'routine') return `#${id} "${todo.title}" es una rutina - usa checkin_routine para marcarla, no complete_todo.`;
    todosRepo.complete(userId, id);

    // Best-effort celebration sticker alongside the text reply - never let this delay/break the
    // actual confirmation (see util/stickers.ts).
    pickCelebrationSticker()
      .then((webp) => (webp ? ctx.wa.sendSticker(targetJid, webp) : undefined))
      .catch(() => {});

    return `Tarea #${id} "${todo.title}" marcada como hecha. 🎉`;
  },
};
