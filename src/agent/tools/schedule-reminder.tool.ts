import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { normalizeDate, parseWall, nowLocal } from '../../util/datetime.js';
import { phoneToJid, isJid } from '../../util/jid.js';
import type { RecurrenceFreq } from '../../types/index.js';

const FREQS: RecurrenceFreq[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export const scheduleReminderTool: Tool = {
  name: 'schedule_reminder',
  description:
    'Programa un recordatorio para un momento futuro (fecha/hora concreta, o "en 5 minutos", o repetitivo). Calcula tú la fecha/hora exacta a partir de la fecha/hora actual que tienes en el prompt.',
  parameters: {
    type: 'object',
    properties: {
      run_at: {
        type: 'string',
        description: "Momento exacto de la próxima ejecución, 'YYYY-MM-DD HH:mm' (hora local).",
      },
      message: { type: 'string', description: 'Texto del recordatorio a enviar.' },
      category: { type: 'string', description: 'Categoría opcional para clasificar el recordatorio.' },
      target: {
        type: 'string',
        description: 'A quién enviárselo: nombre de un contacto o número. Si se omite, es para mí.',
      },
      recurrence_freq: {
        type: 'string',
        enum: FREQS,
        description: 'Frecuencia de repetición. "none" = una sola vez.',
      },
      recurrence_interval: {
        type: 'number',
        description: 'Cada cuántas unidades de recurrence_freq se repite (ej. 2 = cada 2 semanas). Default 1.',
      },
    },
    required: ['run_at', 'message'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const runAt = normalizeDate(String(args.run_at ?? ''));
    if (parseWall(runAt) <= parseWall(nowLocal())) {
      return 'El momento debe ser en el futuro.';
    }

    let targetJid: string | null = null;
    if (args.target) {
      const raw = String(args.target);
      if (isJid(raw)) {
        targetJid = raw;
      } else {
        const matches = contactsRepo.findByName(ctx.userId, raw);
        if (matches.length === 1) targetJid = contactsRepo.sendTarget(matches[0]);
        else if (/^[\d\s()+-]{6,}$/.test(raw)) targetJid = phoneToJid(raw);
        else if (matches.length > 1) return `Hay varios contactos que coinciden con "${raw}", sé más específico.`;
        else return `No encontré ningún contacto llamado "${raw}".`;
      }
    }

    let categoryId: number | null = null;
    if (args.category) {
      categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;
    }

    const freq = FREQS.includes(args.recurrence_freq as RecurrenceFreq)
      ? (args.recurrence_freq as RecurrenceFreq)
      : 'none';
    const interval = Number(args.recurrence_interval) > 0 ? Number(args.recurrence_interval) : 1;

    const id = remindersRepo.create(ctx.userId, {
      message: String(args.message ?? ''),
      runAt,
      targetJid: targetJid ?? ctx.ownerJid,
      categoryId,
      recurrenceFreq: freq,
      recurrenceInterval: interval,
    });

    const recurrenceNote = freq !== 'none' ? ` (se repite cada ${interval} ${freq})` : '';
    return `Recordatorio #${id} programado para ${runAt}${recurrenceNote}.`;
  },
};
