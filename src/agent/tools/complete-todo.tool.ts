import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { sendAutoSticker, TODO_DONE_KEYWORDS, NIGHT_KEYWORDS } from '../../util/stickers.js';
import { maybeNightFarewell } from '../agenda.js';
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

    // If this was the LAST pending todo/routine for today (and it's late enough), also close the
    // day with a "buenas noches" - symmetric to the automatic morning "buenos días" agenda (see
    // agent/agenda.ts's maybeNightFarewell). One sticker either way, from the admin's own pack
    // (see util/stickers.ts) - the night one wins over the celebration when both apply, and
    // nothing is sent if no saved sticker fits. Best-effort, never blocks the confirmation.
    const farewell = maybeNightFarewell(userId);
    if (farewell) sendAutoSticker(ctx.wa, targetJid, NIGHT_KEYWORDS, { force: true });
    else sendAutoSticker(ctx.wa, targetJid, TODO_DONE_KEYWORDS);

    return `Tarea #${id} "${todo.title}" marcada como hecha. 🎉${farewell ? `\n\n${farewell}` : ''}`;
  },
};
