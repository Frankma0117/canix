import type { Tool } from '../../tool-registry.js';
import { todosModel } from '../../../models/todos.model.js';
import { habitLogsModel } from '../../../models/habit-logs.model.js';
import { todayLocal } from '../../../shared/utils/datetime.js';
import { sendMomentSticker } from '../../../services/stickers/stickers.service.js';
import { maybeNightFarewell } from '../../../services/agenda/agenda.service.js';
import { routineStreak } from '../../../services/routines/routine-schedule.js';
import { logRoutineAnswer } from '../../../services/reminders/reminder-prompts.service.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

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
    const todo = todosModel.getById(userId, id);
    if (!todo || todo.scope !== 'routine') return `No encontré ninguna rutina con el ⟦${id}⟧.`;

    const date = args.date ? String(args.date) : todayLocal();
    const done = args.done === undefined ? true : Boolean(args.done);
    habitLogsModel.checkIn(id, date, done, args.note ? String(args.note) : null);

    logRoutineAnswer(userId, id, date, done, 'chat');

    const streak = routineStreak(todo, todayLocal());

    let farewell: string | null = null;
    if (done) {
      // Same "buenas noches" close-of-day check as complete_todo.tool.ts - only when checking in as
      // done (not when marking NOT done, since that isn't "finishing" anything) and only for today's
      // date (a late check-in/backfill for a past date shouldn't trigger tonight's farewell).
      if (date === todayLocal()) farewell = maybeNightFarewell(userId);

      // Only celebrate an actual completion - never a "congrats" sticker for a checkin marking the
      // routine as NOT done. One sticker from the admin's pack (night one wins when it's the close
      // of the day), nothing if none fits - see shared/utils/stickers.ts. Best-effort, never blocks.
      if (farewell) sendMomentSticker(ctx.wa, targetJid, 'good_night', { force: true });
      else sendMomentSticker(ctx.wa, targetJid, 'routine_done');
    }

    return done
      ? `¡"${todo.title}" hecha el ${date}! 🎉 Racha actual: ${streak}.${farewell ? `\n\n${farewell}` : ''}`
      : `Ok, marqué "${todo.title}" como NO hecha el ${date}. Racha actual: ${streak}.`;
  },
};
