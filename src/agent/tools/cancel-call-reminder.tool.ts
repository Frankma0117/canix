import type { Tool } from '../tool-registry.js';
import { callRemindersRepo } from '../../db/repositories/call-reminders.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const cancelCallReminderTool: Tool = {
  name: 'cancel_call_reminder',
  description:
    'Cancela un recordatorio/alarma por llamada pendiente (a diferencia de delete_call_reminder, lo conserva en el historial marcado como cancelado).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio por llamada a cancelar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para cancelar SU llamada en vez de la tuya.',
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
    const ok = callRemindersRepo.cancel(userId, id);
    if (!ok) return `No encontré el recordatorio por llamada #${id} pendiente para cancelar.`;
    return `Recordatorio por llamada #${id} cancelado.`;
  },
};
