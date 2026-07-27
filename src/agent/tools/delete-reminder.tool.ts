import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';

export const deleteReminderTool: Tool = {
  name: 'delete_reminder',
  description:
    'Elimina un recordatorio por completo (a diferencia de cancel_reminder, que solo lo marca cancelado pero lo conserva en el historial).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id del recordatorio a eliminar.' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const reminder = remindersRepo.getById(ctx.userId, id);
    if (!reminder) return `No encontré el recordatorio #${id}.`;
    remindersRepo.remove(ctx.userId, id);
    return `Recordatorio #${id} eliminado.`;
  },
};
