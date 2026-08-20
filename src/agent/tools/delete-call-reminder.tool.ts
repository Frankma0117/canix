import type { Tool } from '../tool-registry.js';
import { callRemindersRepo } from '../../db/repositories/call-reminders.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteCallReminderTool: Tool = {
  name: 'delete_call_reminder',
  description: 'Elimina un recordatorio/alarma por llamada por completo (a diferencia de cancel_call_reminder, que solo lo marca cancelado).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio por llamada a eliminar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU llamada en vez de la tuya.',
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
    if (!callRemindersRepo.getById(userId, id)) return `No encontré el recordatorio por llamada #${id}.`;
    callRemindersRepo.remove(userId, id);
    return `Recordatorio por llamada #${id} eliminado.`;
  },
};
