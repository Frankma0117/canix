import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { normalizeDate, parseWall, nowLocal } from '../../util/datetime.js';
import { phoneToJid, isJid } from '../../util/jid.js';
import type { RecurrenceFreq } from '../../types/index.js';

const FREQS: RecurrenceFreq[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export const editReminderTool: Tool = {
  name: 'edit_reminder',
  description:
    'Edita un recordatorio o fecha importante ya programado (mensaje, momento, categoría, destinatario y/o ' +
    'recurrencia) sin borrarlo y crear uno nuevo. No sirve para los recordatorios internos de una rutina ' +
    '(routine_reminder/routine_checkin) - para esos usa edit_routine, que además mueve el chequeo junto con el aviso.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio a editar.' },
      message: { type: 'string', description: 'Nuevo texto (opcional).' },
      run_at: { type: 'string', description: "Nuevo momento 'YYYY-MM-DD HH:mm' (opcional)." },
      category: { type: 'string', description: 'Nueva categoría (opcional).' },
      target: { type: 'string', description: 'Nuevo destinatario: nombre de contacto o número (opcional).' },
      recurrence_freq: { type: 'string', enum: FREQS, description: 'Nueva frecuencia de repetición (opcional).' },
      recurrence_interval: { type: 'number', description: 'Nuevo intervalo de repetición (opcional).' },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const reminder = remindersRepo.getById(ctx.userId, id);
    if (!reminder) return `No encontré el recordatorio #${id}.`;
    if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin') {
      return `#${id} es parte de una rutina - usa edit_routine (id de la rutina, no del recordatorio) para cambiarle el horario.`;
    }
    if (reminder.kind === 'daily_agenda') return `#${id} es el aviso automático de la mañana, no se edita por aquí.`;
    if (reminder.kind === 'flexible') {
      return `#${id} es un recordatorio flexible (con ventana horaria) - por ahora bórralo con delete_reminder y créalo de nuevo con schedule_flexible_reminder si quieres cambiar la ventana.`;
    }

    let runAt: string | undefined;
    if (args.run_at !== undefined) {
      runAt = normalizeDate(String(args.run_at));
      if (parseWall(runAt) <= parseWall(nowLocal())) return 'El nuevo momento debe ser en el futuro.';
    }

    let categoryId: number | undefined;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    let targetJid: string | undefined;
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

    const recurrenceFreq = FREQS.includes(args.recurrence_freq as RecurrenceFreq)
      ? (args.recurrence_freq as RecurrenceFreq)
      : undefined;
    const recurrenceInterval = Number(args.recurrence_interval) > 0 ? Number(args.recurrence_interval) : undefined;

    remindersRepo.update(ctx.userId, id, {
      message: args.message ? String(args.message) : undefined,
      runAt,
      categoryId,
      targetJid,
      recurrenceFreq,
      recurrenceInterval,
    });

    const updated = remindersRepo.getById(ctx.userId, id)!;
    return `Recordatorio #${id} actualizado: "${updated.message}" para ${updated.run_at}.`;
  },
};
