import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { notesRepo } from '../../db/repositories/notes.repo.js';
import { normalizeDate, time12h, todayLocal, addDays } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';
import { findFreeSlot } from '../agenda.js';
import { dayLabel } from '../views.js';

const TIME_RE = /^\d{1,2}:\d{2}$/;
const pad = (t: string) => t.padStart(5, '0');

/**
 * "Recuérdame llamar al banco en algún momento", "anota que debo revisar las llantas cuando pueda":
 * instead of a vague someday, it's put in the first free gap of the person's day (see agenda.ts's
 * findFreeSlot) and the time is said back, so they can move it if it doesn't suit them.
 */
export const scheduleFreeSlotReminderTool: Tool = {
  name: 'schedule_free_slot_reminder',
  description:
    'Para algo que hay que hacer "en algún momento", "cuando pueda", "un día de estos", "esta semana" SIN hora ' +
    'concreta (una sola vez): busca el primer espacio libre en mi agenda (sin rutinas, recordatorios ni citas) y ' +
    'programa ahí el recordatorio, diciéndome a qué hora quedó. Si además hay información para guardar, pásala en ' +
    'note_tips y queda también como nota de tips clave. NO es para cosas diarias en una ventana ' +
    '(eso es schedule_flexible_reminder) ni para algo con hora dada (schedule_reminder).',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Qué recordar, en tono natural (ej. "llamar al banco para lo de la tarjeta").' },
      duration_minutes: { type: 'number', description: 'Cuánto tiempo calculas que toma (default 30).' },
      earliest_date: { type: 'string', description: "Desde qué fecha buscar, 'YYYY-MM-DD' (ej. \"la otra semana\"). Default hoy." },
      window_start: { type: 'string', description: "Desde qué hora del día, 'HH:mm' (default 08:00; ej. 18:00 si dijo \"en la tarde-noche\")." },
      window_end: { type: 'string', description: "Hasta qué hora del día, 'HH:mm' (default 21:00)." },
      category: { type: 'string', description: 'Categoría opcional.' },
      note_tips: {
        type: 'string',
        description: 'Opcional: datos para guardar como nota, ya resumidos en tips clave (una línea por tip, empezando con "• ").',
      },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para agendárselo a ella.',
      },
    },
    required: ['message'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const message = String(args.message ?? '').trim();
    if (!message) return 'Me falta qué recordarte.';
    const windowStart = args.window_start && TIME_RE.test(String(args.window_start)) ? pad(String(args.window_start)) : undefined;
    const windowEnd = args.window_end && TIME_RE.test(String(args.window_end)) ? pad(String(args.window_end)) : undefined;
    const minutes = Number(args.duration_minutes) > 0 ? Math.round(Number(args.duration_minutes)) : 30;
    const fromDate = args.earliest_date ? normalizeDate(String(args.earliest_date)).slice(0, 10) : undefined;

    const runAt = findFreeSlot(userId, { minutes, windowStart, windowEnd, fromDate, days: 14 });
    if (!runAt) return 'No encontré ningún espacio libre en las próximas dos semanas en ese horario - pregúntame una hora concreta.';

    const categoryId = args.category ? categoriesRepo.findOrCreate(userId, String(args.category)).id : null;
    const id = remindersRepo.create(userId, {
      message,
      runAt,
      targetJid,
      categoryId,
      recurrenceFreq: 'none',
      recurrenceInterval: 1,
    });

    const tips = String(args.note_tips ?? '').trim();
    const noteId = tips ? notesRepo.create(userId, { content: tips, title: message.slice(0, 80), categoryId }) : null;

    const date = runAt.slice(0, 10);
    const day = date === todayLocal() ? 'hoy' : date === addDays(todayLocal(), 1).slice(0, 10) ? 'mañana' : dayLabel(date).toLowerCase();
    return (
      `🗓️ Busqué un espacio libre en tu agenda: quedó el recordatorio #${id} para ${day} a las ${time12h(runAt)} ` +
      `(${minutes} min).${noteId ? ` Y guardé los tips en la nota #${noteId}.` : ''} ` +
      'Dile a la persona la hora y que si no le sirve, le busco otra o la pone donde quiera.'
    );
  },
};
