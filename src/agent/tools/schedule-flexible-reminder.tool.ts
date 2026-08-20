import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { todayLocal, dateOnly, addDays, randomTimeOnDate, parseWall, nowLocal } from '../../util/datetime.js';
import { flexibleReminderMessage } from '../../util/motivational.js';
import { resolveActingUser } from './act-on-behalf.js';

const TIME_RE = /^\d{1,2}:\d{2}$/;

export const scheduleFlexibleReminderTool: Tool = {
  name: 'schedule_flexible_reminder',
  description:
    'Programa algo que se repite todos los días pero SIN hora fija, dentro de una ventana horaria ' +
    '(ej. "una pausa activa de 10 minutos entre 3pm y 5pm", "practicar Duolingo en algún momento del día"). ' +
    'Cada día elige una hora al azar dentro de la ventana, para que no se sienta mecánico. ' +
    'Si es a "cualquier hora del día", usa una ventana amplia (ej. 08:00 a 21:00).',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Qué recordar (ej. "Pausa activa de 10 minutos").' },
      window_start: { type: 'string', description: "Inicio de la ventana horaria, 'HH:mm'." },
      window_end: { type: 'string', description: "Fin de la ventana horaria, 'HH:mm'. Debe ser después de window_start." },
      category: { type: 'string', description: 'Categoría opcional.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para agendárselo a ella en vez de a ti.',
      },
    },
    required: ['message', 'window_start', 'window_end'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const message = String(args.message ?? '').trim();
    const windowStart = String(args.window_start ?? '');
    const windowEnd = String(args.window_end ?? '');
    if (!message) return 'Me falta el mensaje del recordatorio.';
    if (!TIME_RE.test(windowStart) || !TIME_RE.test(windowEnd)) {
      return "window_start y window_end tienen que ser horas en formato 'HH:mm'.";
    }

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    let runAt = randomTimeOnDate(todayLocal(), windowStart, windowEnd);
    if (parseWall(runAt) <= parseWall(nowLocal())) {
      // Today's window already passed (or we landed too close to now) - start tomorrow instead.
      runAt = randomTimeOnDate(dateOnly(addDays(todayLocal(), 1)), windowStart, windowEnd);
    }

    const id = remindersRepo.create(userId, {
      message: flexibleReminderMessage(message),
      runAt,
      targetJid,
      categoryId,
      recurrenceFreq: 'daily',
      recurrenceInterval: 1,
      kind: 'flexible',
      windowStart,
      windowEnd,
    });

    return `⏰ Listo, quedó el recordatorio flexible #${id} "${message}": todos los días entre ${windowStart} y ${windowEnd} (hoy/próxima vez: ${runAt}).`;
  },
};
