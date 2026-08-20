import type { Tool } from '../tool-registry.js';
import { callRemindersRepo } from '../../db/repositories/call-reminders.repo.js';
import { updateCallReminder } from '../../calls/call-reminders.service.js';
import { normalizeDate, parseWall, nowLocal } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { CallReminderType, RecurrenceFreq } from '../../types/index.js';

const FREQS: RecurrenceFreq[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const TIME_RE = /^\d{1,2}:\d{2}$/;

export const editCallReminderTool: Tool = {
  name: 'edit_call_reminder',
  description:
    'Edita un recordatorio o alarma por llamada telefónica ya programado (mensaje, tipo, teléfono, fecha/hora, ' +
    'o recurrencia) sin borrarlo y crear uno nuevo. No funciona mientras la llamada está en curso.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio por llamada a editar.' },
      message: { type: 'string', description: 'Nuevo mensaje (opcional, solo aplica a call_type "reminder").' },
      call_type: { type: 'string', enum: ['reminder', 'alarm'], description: 'Nuevo tipo (opcional).' },
      date: { type: 'string', description: "Nueva fecha 'YYYY-MM-DD' (opcional, junto con time)." },
      time: { type: 'string', description: "Nueva hora 'HH:mm' (opcional, junto con date)." },
      phone_number: { type: 'string', description: 'Nuevo número con indicativo de país (opcional).' },
      recurrence_freq: { type: 'string', enum: FREQS, description: 'Nueva frecuencia de repetición (opcional).' },
      recurrence_interval: { type: 'number', description: 'Nuevo intervalo de repetición, ej. 2 = "cada 2" (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU llamada en vez de la tuya.',
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
    const reminder = callRemindersRepo.getById(userId, id);
    if (!reminder) return `No encontré el recordatorio por llamada #${id}.`;

    let scheduledAt: string | undefined;
    if (args.date || args.time) {
      const date = String(args.date ?? reminder.scheduled_at.slice(0, 10));
      const timeRaw = String(args.time ?? reminder.scheduled_at.slice(11, 16));
      if (!TIME_RE.test(timeRaw)) return "Error: time debe tener formato 'HH:mm'.";
      scheduledAt = normalizeDate(`${date} ${timeRaw}`);
      if (parseWall(scheduledAt) <= parseWall(nowLocal())) return 'La nueva fecha/hora debe ser en el futuro.';
    }

    const recurrenceFreq = FREQS.includes(args.recurrence_freq as RecurrenceFreq) ? (args.recurrence_freq as RecurrenceFreq) : undefined;
    const recurrenceInterval = Number(args.recurrence_interval) > 0 ? Number(args.recurrence_interval) : undefined;
    const callType: CallReminderType | undefined = args.call_type === 'reminder' || args.call_type === 'alarm' ? args.call_type : undefined;

    const result = updateCallReminder(userId, id, {
      phoneNumber: args.phone_number ? String(args.phone_number) : undefined,
      message: args.message !== undefined ? String(args.message) : undefined,
      callType,
      scheduledAt,
      recurrenceFreq,
      recurrenceInterval,
    });
    if (!result.ok) return `Error: ${result.error}`;

    const updated = result.value;
    return `Recordatorio por llamada #${id} actualizado: ${updated.call_type === 'alarm' ? '⏰ alarma' : `📞 "${updated.message}"`} - ${updated.phone_number} - ${updated.scheduled_at}.`;
  },
};
