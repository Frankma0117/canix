import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { normalizeDate, parseWall, nowLocal, dateOnly, addDays, randomTimeOnDate } from '../../util/datetime.js';
import { phoneToJid, isJid } from '../../util/jid.js';
import { resolveActingUser } from './act-on-behalf.js';
import { MIN_INTERVAL_SECONDS, MAX_REPEAT_COUNT } from './reminder-limits.js';
import type { RecurrenceFreq } from '../../types/index.js';

const FREQS: RecurrenceFreq[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const TIME_RE = /^\d{1,2}:\d{2}$/;

export const editReminderTool: Tool = {
  name: 'edit_reminder',
  description:
    'Edita un recordatorio o fecha importante ya programado (mensaje, momento, categoría, destinatario y/o ' +
    'recurrencia) sin borrarlo y crear uno nuevo. Sirve también para recordatorios flexibles (window_start/' +
    'window_end) y de intervalo (interval_seconds/repeat_count/with_audio). No sirve para los recordatorios ' +
    'internos de una rutina (routine_reminder/routine_checkin) - para esos usa edit_routine, que además mueve ' +
    'el chequeo junto con el aviso.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio a editar.' },
      message: { type: 'string', description: 'Nuevo texto (opcional).' },
      run_at: { type: 'string', description: "Nuevo momento 'YYYY-MM-DD HH:mm' (opcional, no aplica a flexible)." },
      category: { type: 'string', description: 'Nueva categoría (opcional).' },
      target: { type: 'string', description: 'Nuevo destinatario: nombre de contacto o número (opcional).' },
      recurrence_freq: { type: 'string', enum: FREQS, description: 'Nueva frecuencia de repetición (opcional).' },
      recurrence_interval: { type: 'number', description: 'Nuevo intervalo de repetición (opcional).' },
      window_start: { type: 'string', description: "Solo para recordatorios flexibles: nuevo inicio de ventana 'HH:mm'." },
      window_end: { type: 'string', description: "Solo para recordatorios flexibles: nuevo fin de ventana 'HH:mm'." },
      interval_seconds: { type: 'number', description: `Solo para recordatorios de intervalo: nuevos segundos entre avisos (mínimo ${MIN_INTERVAL_SECONDS}).` },
      repeat_count: { type: 'number', description: `Solo para recordatorios de intervalo: nuevo total de repeticiones (máximo ${MAX_REPEAT_COUNT}).` },
      with_audio: { type: 'boolean', description: 'Solo para recordatorios de intervalo: si además manda nota de voz.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU recordatorio en vez del tuyo.',
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
    if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin') {
      return `#${id} es parte de una rutina - usa edit_routine (id de la rutina, no del recordatorio) para cambiarle el horario.`;
    }
    if (reminder.kind === 'daily_agenda' || reminder.kind === 'weekly_report') {
      return `#${id} es un aviso automático del sistema, no se edita por aquí.`;
    }

    if (reminder.kind === 'flexible') {
      const windowStart = args.window_start !== undefined ? String(args.window_start) : undefined;
      const windowEnd = args.window_end !== undefined ? String(args.window_end) : undefined;
      if ((windowStart && !TIME_RE.test(windowStart)) || (windowEnd && !TIME_RE.test(windowEnd))) {
        return "Error: window_start/window_end deben ser horas en formato 'HH:mm'.";
      }
      if (args.run_at !== undefined) return `#${id} es flexible (sin hora fija) - usa window_start/window_end en vez de run_at.`;
      if (args.interval_seconds !== undefined || args.repeat_count !== undefined || args.with_audio !== undefined) {
        return `#${id} es un recordatorio flexible, no de intervalo - esos campos no aplican aquí.`;
      }

      const finalStart = windowStart ?? reminder.window_start!;
      const finalEnd = windowEnd ?? reminder.window_end!;
      let runAt: string | undefined;
      if (windowStart || windowEnd) {
        runAt = randomTimeOnDate(dateOnly(reminder.run_at), finalStart, finalEnd);
        if (parseWall(runAt) <= parseWall(nowLocal())) runAt = randomTimeOnDate(dateOnly(addDays(runAt, 1)), finalStart, finalEnd);
      }

      let categoryId: number | undefined;
      if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;
      let resolvedTargetJid: string | undefined;
      if (args.target) {
        const resolved = resolveTarget(userId, String(args.target));
        if ('error' in resolved) return resolved.error;
        resolvedTargetJid = resolved.jid;
      }

      remindersRepo.update(userId, id, {
        message: args.message ? String(args.message) : undefined,
        runAt,
        windowStart,
        windowEnd,
        categoryId,
        targetJid: resolvedTargetJid,
      });
      const updated = remindersRepo.getById(userId, id)!;
      return `Recordatorio flexible #${id} actualizado: ventana ${updated.window_start}-${updated.window_end} (próxima vez: ${updated.run_at}).`;
    }

    if (reminder.kind === 'interval') {
      if (args.run_at !== undefined || args.recurrence_freq !== undefined || args.recurrence_interval !== undefined) {
        return `#${id} es de intervalo (maneja su propio ciclo) - no acepta run_at ni recurrencia, usa interval_seconds/repeat_count.`;
      }
      if (args.window_start !== undefined || args.window_end !== undefined) {
        return `#${id} es un recordatorio de intervalo, no flexible - esos campos no aplican aquí.`;
      }

      let intervalSeconds: number | undefined;
      if (args.interval_seconds !== undefined) {
        intervalSeconds = Number(args.interval_seconds);
        if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
          return `Error: interval_seconds debe ser un número de al menos ${MIN_INTERVAL_SECONDS}.`;
        }
      }
      let repeatCount: number | undefined;
      if (args.repeat_count !== undefined) {
        repeatCount = Number(args.repeat_count);
        if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > MAX_REPEAT_COUNT) {
          return `Error: repeat_count debe ser un entero entre 1 y ${MAX_REPEAT_COUNT}.`;
        }
      }

      let categoryId: number | undefined;
      if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

      remindersRepo.update(userId, id, {
        message: args.message ? String(args.message) : undefined,
        intervalSeconds,
        repeatCount,
        withAudio: typeof args.with_audio === 'boolean' ? args.with_audio : undefined,
        categoryId,
      });
      const updated = remindersRepo.getById(userId, id)!;
      return `Recordatorio de intervalo #${id} actualizado: cada ${updated.interval_seconds}s, ${updated.repeat_count} veces.`;
    }

    let runAt: string | undefined;
    if (args.run_at !== undefined) {
      runAt = normalizeDate(String(args.run_at));
      if (parseWall(runAt) <= parseWall(nowLocal())) return 'El nuevo momento debe ser en el futuro.';
    }

    let categoryId: number | undefined;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    let targetJidField: string | undefined;
    if (args.target) {
      const resolved = resolveTarget(userId, String(args.target));
      if ('error' in resolved) return resolved.error;
      targetJidField = resolved.jid;
    }

    const recurrenceFreq = FREQS.includes(args.recurrence_freq as RecurrenceFreq)
      ? (args.recurrence_freq as RecurrenceFreq)
      : undefined;
    const recurrenceInterval = Number(args.recurrence_interval) > 0 ? Number(args.recurrence_interval) : undefined;

    remindersRepo.update(userId, id, {
      message: args.message ? String(args.message) : undefined,
      runAt,
      categoryId,
      targetJid: targetJidField,
      recurrenceFreq,
      recurrenceInterval,
    });

    const updated = remindersRepo.getById(userId, id)!;
    return `Recordatorio #${id} actualizado: "${updated.message}" para ${updated.run_at}.`;
  },
};

/** Resolves a contact-name-or-number `target` string to a jid. */
function resolveTarget(userId: number, raw: string): { jid: string } | { error: string } {
  if (isJid(raw)) return { jid: raw };
  const matches = contactsRepo.findByName(userId, raw);
  if (matches.length === 1) return { jid: contactsRepo.sendTarget(matches[0]) };
  if (/^[\d\s()+-]{6,}$/.test(raw)) return { jid: phoneToJid(raw) };
  if (matches.length > 1) return { error: `Hay varios contactos que coinciden con "${raw}", sé más específico.` };
  return { error: `No encontré ningún contacto llamado "${raw}".` };
}
