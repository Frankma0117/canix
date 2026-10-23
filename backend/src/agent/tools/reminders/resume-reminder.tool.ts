import type { Tool } from '../../tool-registry.js';
import { remindersModel } from '../../../models/reminders.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const resumeReminderTool: Tool = {
  name: 'resume_reminder',
  description: 'Reanuda de inmediato un recordatorio puntual pausado con pause_reminder, antes de que se cumplan los días.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio a reanudar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para reanudarle su recordatorio en vez del tuyo.',
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
    const reminder = remindersModel.getById(userId, id);
    if (!reminder) return `No encontré el recordatorio ⟦${id}⟧.`;
    if (!reminder.paused_until) return `⟦${id}⟧ no estaba pausado.`;
    remindersModel.setPausedUntil(userId, id, null);
    return `🔔 Listo, reanudé el recordatorio ⟦${id}⟧.`;
  },
};
