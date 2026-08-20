import type { Tool } from '../tool-registry.js';
import { createCallReminder } from '../../calls/call-reminders.service.js';
import { normalizeDate, parseWall, nowLocal } from '../../util/datetime.js';
import { jidToPhone } from '../../util/jid.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { CallReminderType, RecurrenceFreq } from '../../types/index.js';

const FREQS: RecurrenceFreq[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

/**
 * Deliberately NOT a general-purpose reminder channel - a real phone call (Twilio Programmable
 * Voice) is special, disruptive, and costs real money per call, unlike WhatsApp. This tool exists
 * for exactly two cases the user explicitly asks for: a genuinely important reminder they want
 * delivered as an actual call instead of a WhatsApp text, or a wake-up alarm. See the description
 * below - the model is instructed to keep defaulting to schedule_reminder/schedule_important_date
 * for everything else.
 */
export const scheduleCallReminderTool: Tool = {
  name: 'schedule_call_reminder',
  description:
    'Programa una LLAMADA TELEFÓNICA real (no un mensaje de WhatsApp). Es especial - úsala SOLO cuando pida ' +
    'explícitamente que lo llamen por teléfono ("llámame", "que timbre el teléfono", "despiértame con una ' +
    'llamada", "necesito que suene la alarma") para algo verdaderamente importante o para despertarse. NUNCA ' +
    'la uses para un recordatorio normal - para eso sigue usando schedule_reminder o schedule_important_date, ' +
    'que no llaman a nadie ni cuestan dinero real. Dos variantes (call_type): "reminder" llama y DICE el ' +
    'mensaje en voz, luego cuelga; "alarm" solo hace timbrar el teléfono y cuelga apenas contestan, sin decir ' +
    'nada - el timbre en sí es la alarma, como un despertador.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Lo que se dice en voz durante la llamada. Solo aplica a call_type "reminder" - se ignora (nunca se dice) para "alarm".',
      },
      call_type: {
        type: 'string',
        enum: ['reminder', 'alarm'],
        description: '"reminder" (default): llama y dice el mensaje. "alarm": solo timbra y cuelga al contestar, no dice nada.',
      },
      date: { type: 'string', description: "Fecha de la primera (o única) llamada, 'YYYY-MM-DD'." },
      time: { type: 'string', description: "Hora de la llamada, 'HH:mm'." },
      recurrence_freq: {
        type: 'string',
        enum: FREQS,
        description:
          '"none" (default) para una sola vez. "daily"/"weekly"/"monthly"/"yearly" solo si además de importante ' +
          'es algo recurrente que el usuario pidió explícitamente que se repita por llamada (ej. una medicina ' +
          'diaria que de verdad necesita que lo llamen) - combínalo con recurrence_interval para "cada N" (ej. ' +
          '"cada 2 días" = daily + recurrence_interval 2). Esto NO habilita llamadas para cosas rutinarias/casuales.',
      },
      recurrence_interval: {
        type: 'number',
        description: 'Cada cuántas unidades de recurrence_freq se repite (ej. 2 = "cada 2 días/semanas/meses/años"). Default 1.',
      },
      phone_number: {
        type: 'string',
        description: 'Número con indicativo de país, solo si es distinto al número de WhatsApp de quien pide esto. Si se omite, llama a su propio número.',
      },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para llamarla a ella en vez de a ti.',
      },
    },
    required: ['date', 'time'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const callType: CallReminderType = args.call_type === 'alarm' ? 'alarm' : 'reminder';
    const message = String(args.message ?? '').trim();
    if (callType === 'reminder' && !message) return 'Error: falta el mensaje que se dirá en la llamada.';

    const date = String(args.date ?? '').trim();
    const timeRaw = String(args.time ?? '');
    if (!date || !/^\d{1,2}:\d{2}$/.test(timeRaw)) return 'Error: falta la fecha u hora de la llamada.';

    const scheduledAt = normalizeDate(`${date} ${timeRaw}`);
    if (parseWall(scheduledAt) <= parseWall(nowLocal())) {
      return 'Esa fecha/hora ya pasó - dame una en el futuro.';
    }

    let phoneNumber = args.phone_number ? String(args.phone_number).trim() : jidToPhone(targetJid);
    if (!phoneNumber) return 'No tengo un número de teléfono para esta persona - dame uno con indicativo de país (ej. +573001234567).';
    if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber.replace(/\D/g, '')}`;

    const recurrenceFreq = FREQS.includes(args.recurrence_freq as RecurrenceFreq) ? (args.recurrence_freq as RecurrenceFreq) : 'none';
    const recurrenceInterval = Number(args.recurrence_interval) > 0 ? Number(args.recurrence_interval) : 1;

    const result = createCallReminder({ userId, phoneNumber, message, callType, scheduledAt, recurrenceFreq, recurrenceInterval });
    if (!result.ok) return `Error: ${result.error}`;

    const recurrenceNote =
      recurrenceFreq === 'none'
        ? ''
        : ` (se repite cada ${recurrenceInterval > 1 ? `${recurrenceInterval} ` : ''}${
            { daily: 'día(s)', weekly: 'semana(s)', monthly: 'mes(es)', yearly: 'año(s)' }[recurrenceFreq]
          })`;

    return callType === 'alarm'
      ? `⏰ Alarma por llamada #${result.value.id} programada para ${scheduledAt}${recurrenceNote} - el teléfono timbrará y colgará solo al contestar.`
      : `📞 Recordatorio por llamada #${result.value.id} programado para ${scheduledAt}${recurrenceNote}: "${message}".`;
  },
};
