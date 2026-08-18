import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteReminderTool: Tool = {
  name: 'delete_reminder',
  description:
    'Elimina un recordatorio por completo (a diferencia de cancel_reminder, que solo lo marca cancelado pero lo conserva en el historial).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio a eliminar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU recordatorio en vez del tuyo.',
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
    // Consistent with edit_reminder's guard: deleting only one side of a routine's linked pair (or
    // a structural system reminder) would silently half-break it instead of cleanly removing it.
    if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin') {
      return `#${id} es parte de una rutina - usa delete_routine (id de la rutina, no del recordatorio) para eliminarla junto con su historial.`;
    }
    if (reminder.kind === 'daily_agenda' || reminder.kind === 'weekly_report') {
      return `#${id} es un aviso automático del sistema, no se puede eliminar por aquí.`;
    }
    remindersRepo.remove(userId, id);
    return `Recordatorio #${id} eliminado.`;
  },
};
