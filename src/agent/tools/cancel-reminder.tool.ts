import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';

export const cancelReminderTool: Tool = {
  name: 'cancel_reminder',
  description: 'Cancela un recordatorio pendiente por su id.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id del recordatorio a cancelar.' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args) {
    const id = Number(args.id);
    const reminder = remindersRepo.getById(id);
    if (!reminder) return `No encontré el recordatorio #${id}.`;
    remindersRepo.cancel(id);
    return `Recordatorio #${id} cancelado.`;
  },
};
