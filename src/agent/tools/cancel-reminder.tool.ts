import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const cancelReminderTool: Tool = {
  name: 'cancel_reminder',
  description: 'Cancela un recordatorio pendiente por su id.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio a cancelar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para cancelar SU recordatorio en vez del tuyo.',
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
    const reminder = remindersRepo.getById(userId, id);
    if (!reminder) return `No encontré el recordatorio #${id}.`;
    remindersRepo.cancel(userId, id);
    return `Recordatorio #${id} cancelado.`;
  },
};
