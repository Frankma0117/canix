import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { pickCelebrationSticker } from '../../util/stickers.js';
import { stickersRepo } from '../../db/repositories/stickers.repo.js';
import { maybeNightFarewell } from '../agenda.js';
import { resolveActingUser } from './act-on-behalf.js';

const NIGHT_STICKER_KEYWORDS = ['buenas_noches', 'buena_noche', 'good_night', 'buenasnoches'];

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

    // If this was the LAST pending todo/routine for today (and it's late enough), also close the
    // day with a "buenas noches" - symmetric to the automatic morning "buenos días" agenda (see
    // agent/agenda.ts's maybeNightFarewell). Best-effort sticker, same as the celebration one above.
    const farewell = maybeNightFarewell(userId);
    if (farewell) {
      const nightSticker = stickersRepo.findByKeywords(NIGHT_STICKER_KEYWORDS);
      if (nightSticker) ctx.wa.sendSticker(targetJid, nightSticker.data).catch(() => {});
    }

    return `Tarea #${id} "${todo.title}" marcada como hecha. 🎉${farewell ? `\n\n${farewell}` : ''}`;
  },
};
