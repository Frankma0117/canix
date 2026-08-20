import type { Tool } from '../tool-registry.js';
import { callRemindersRepo } from '../../db/repositories/call-reminders.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { CallReminderStatus } from '../../types/index.js';

const UNIT: Record<string, string> = { daily: 'día', weekly: 'semana', monthly: 'mes', yearly: 'año' };

function recurrenceNote(freq: string, interval: number): string {
  if (freq === 'none') return '';
  return ` (cada ${interval > 1 ? `${interval} ${UNIT[freq]}s` : UNIT[freq]})`;
}

export const listCallRemindersTool: Tool = {
  name: 'list_call_reminders',
  description: 'Lista mis recordatorios/alarmas por llamada telefónica (Twilio), opcionalmente filtrando por estado.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
        description: 'Estado a filtrar (default: pending).',
      },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS llamadas en vez de las tuyas.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const status = (args.status as CallReminderStatus) ?? 'pending';
    const reminders = callRemindersRepo.listAll(userId, status);
    if (reminders.length === 0) return 'No hay recordatorios por llamada que coincidan.';

    return reminders
      .map((r) => {
        const label = r.call_type === 'alarm' ? '⏰ alarma' : `📞 "${r.message}"`;
        return `#${r.id} ${label} - ${r.phone_number} - ${r.scheduled_at}${recurrenceNote(r.recurrence_freq, r.recurrence_interval)}`;
      })
      .join('\n');
  },
};
