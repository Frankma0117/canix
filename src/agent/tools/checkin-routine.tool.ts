import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { habitLogsRepo } from '../../db/repositories/habit-logs.repo.js';
import { todayLocal } from '../../util/datetime.js';
import { sendAutoSticker, ROUTINE_DONE_KEYWORDS, NIGHT_KEYWORDS } from '../../util/stickers.js';
import { maybeNightFarewell } from '../agenda.js';
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
    if (!todo || todo.scope !== 'routine') return `No encontré ninguna rutina con el #${id}.`;

    const date = args.date ? String(args.date) : todayLocal();
    const done = args.done === undefined ? true : Boolean(args.done);
    habitLogsRepo.checkIn(id, date, done, args.note ? String(args.note) : null);

    const streak = habitLogsRepo.currentStreak(id, todayLocal());

    let farewell: string | null = null;
    if (done) {
      // Same "buenas noches" close-of-day check as complete_todo.tool.ts - only when checking in as
      // done (not when marking NOT done, since that isn't "finishing" anything) and only for today's
      // date (a late check-in/backfill for a past date shouldn't trigger tonight's farewell).
      if (date === todayLocal()) farewell = maybeNightFarewell(userId);

      // Only celebrate an actual completion - never a "congrats" sticker for a checkin marking the
      // routine as NOT done. One sticker from the admin's pack (night one wins when it's the close
      // of the day), nothing if none fits - see util/stickers.ts. Best-effort, never blocks.
      if (farewell) sendAutoSticker(ctx.wa, targetJid, NIGHT_KEYWORDS, { force: true });
      else sendAutoSticker(ctx.wa, targetJid, ROUTINE_DONE_KEYWORDS);
    }

    return done
      ? `¡"${todo.title}" hecha el ${date}! 🎉 Racha actual: ${streak} día(s).${farewell ? `\n\n${farewell}` : ''}`
      : `Ok, marqué "${todo.title}" como NO hecha el ${date}. Racha actual: ${streak} día(s).`;
  },
};
