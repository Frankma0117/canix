import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { habitLogsRepo } from '../../db/repositories/habit-logs.repo.js';
import { todayLocal } from '../../util/datetime.js';
import { pickCelebrationSticker } from '../../util/stickers.js';
import { resolveActingUser } from './act-on-behalf.js';

export const checkinRoutineTool: Tool = {
  name: 'checkin_routine',
  description: 'Marca una rutina/hábito como hecho (o no hecho) para hoy u otra fecha.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      done: { type: 'boolean', description: 'true si se hizo, false si no. Default true.' },
      date: { type: 'string', description: "Fecha 'YYYY-MM-DD' (default: hoy)." },
      note: { type: 'string', description: 'Nota opcional.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para marcar SU rutina en vez de la tuya.',
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
    if (!todo || todo.scope !== 'routine') return `No encontré la rutina #${id}.`;

    const date = args.date ? String(args.date) : todayLocal();
    const done = args.done === undefined ? true : Boolean(args.done);
    habitLogsRepo.checkIn(id, date, done, args.note ? String(args.note) : null);

    const streak = habitLogsRepo.currentStreak(id, todayLocal());

    if (done) {
      // Only celebrate an actual completion - never send a "congrats" sticker for a checkin that
      // marks the routine as NOT done (see util/stickers.ts). Best-effort, never blocks the reply.
      pickCelebrationSticker()
        .then((webp) => (webp ? ctx.wa.sendSticker(targetJid, webp) : undefined))
        .catch(() => {});
    }

    return `Rutina "${todo.title}" marcada como ${done ? 'hecha' : 'NO hecha'} el ${date}. Racha actual: ${streak} día(s).`;
  },
};
