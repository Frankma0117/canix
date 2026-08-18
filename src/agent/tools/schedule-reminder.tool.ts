import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { normalizeDate, parseWall, nowLocal } from '../../util/datetime.js';
import { phoneToJid, isJid } from '../../util/jid.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { RecurrenceFreq } from '../../types/index.js';

const FREQS: RecurrenceFreq[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export const scheduleReminderTool: Tool = {
  name: 'schedule_reminder',
  description:
    'Programa un recordatorio para un momento futuro (fecha/hora concreta, o "en 5 minutos", o repetitivo). Calcula ' +
    'tú la fecha/hora exacta a partir de la fecha/hora actual que tienes en el prompt. Si el recordatorio es sobre ' +
    'un link ya guardado (ej. "a las 6am recuérdame el ejercicio de tal link"), búscalo primero (list_links/search) ' +
    'y pasa su id en link_id.',
  parameters: {
    type: 'object',
    properties: {
      run_at: {
        type: 'string',
        description: "Momento exacto de la próxima ejecución, 'YYYY-MM-DD HH:mm' (hora local).",
      },
      message: {
        type: 'string',
        description:
          'Texto del recordatorio, en tono natural y cercano (no como ítem de lista). Si el usuario dio el motivo, inclúyelo tal cual - nunca lo inventes.',
      },
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
      link_id: { type: 'number', description: 'Id de un link ya guardado que este recordatorio referencia (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para agendárselo a ella en vez de a ti.',
      },
    },
    required: ['run_at', 'message'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid: actingJid } = acting;

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
        const matches = contactsRepo.findByName(userId, raw);
        if (matches.length === 1) targetJid = contactsRepo.sendTarget(matches[0]);
        else if (/^[\d\s()+-]{6,}$/.test(raw)) targetJid = phoneToJid(raw);
        else if (matches.length > 1) return `Hay varios contactos que coinciden con "${raw}", sé más específico.`;
        else return `No encontré ningún contacto llamado "${raw}".`;
      }
    }

    let categoryId: number | null = null;
    if (args.category) {
      categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;
    }

    let linkId: number | null = null;
    if (args.link_id !== undefined) {
      const link = linksRepo.getById(userId, Number(args.link_id));
      if (!link) return `No encontré el link #${args.link_id}.`;
      linkId = link.id;
    }

    const freq = FREQS.includes(args.recurrence_freq as RecurrenceFreq)
      ? (args.recurrence_freq as RecurrenceFreq)
      : 'none';
    const interval = Number(args.recurrence_interval) > 0 ? Number(args.recurrence_interval) : 1;

    const id = remindersRepo.create(userId, {
      message: String(args.message ?? ''),
      runAt,
      targetJid: targetJid ?? actingJid,
      categoryId,
      recurrenceFreq: freq,
      recurrenceInterval: interval,
      linkId,
    });

    const recurrenceNote = freq !== 'none' ? ` (se repite cada ${interval} ${freq})` : '';
    return `Recordatorio #${id} programado para ${runAt}${recurrenceNote}.`;
  },
};
