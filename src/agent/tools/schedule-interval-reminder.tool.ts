import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { nowLocal, addSeconds } from '../../util/datetime.js';
import { MIN_INTERVAL_SECONDS, MAX_REPEAT_COUNT } from './reminder-limits.js';
import { resolveActingUser } from './act-on-behalf.js';

export const scheduleIntervalReminderTool: Tool = {
  name: 'schedule_interval_reminder',
  description:
    'Programa un aviso que se repite cada cierto tiempo un número fijo de veces (ej. "avísame cada 30 segundos, ' +
    '5 veces, para cambiar de serie de ejercicio"). Útil para timers de ejercicio/descansos o para insistir en algo ' +
    'urgente. El intervalo real mínimo es de unos 20-30 segundos (el bot revisa recordatorios cada 30s). Se puede ' +
    'parar antes de tiempo con cancel_reminder/delete_reminder si el usuario dice "ya, para" o "listo, gracias".',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Qué avisar en cada repetición (ej. "cambia de serie").' },
      interval_seconds: { type: 'number', description: `Segundos entre cada aviso (mínimo ${MIN_INTERVAL_SECONDS}).` },
      repeat_count: { type: 'number', description: `Cuántas veces avisar en total (máximo ${MAX_REPEAT_COUNT}).` },
      start_delay_seconds: {
        type: 'number',
        description: 'Segundos antes del primer aviso. Default 0 (empieza casi de inmediato).',
      },
      with_audio: {
        type: 'boolean',
        description: 'Si además de texto se debe intentar mandar una nota de voz en cada aviso (si hay TTS local configurado). Default false.',
      },
      category: { type: 'string', description: 'Categoría opcional.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para agendárselo a ella en vez de a ti.',
      },
    },
    required: ['message', 'interval_seconds', 'repeat_count'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId, targetJid } = acting;

    const message = String(args.message ?? '').trim();
    if (!message) return 'Me falta el mensaje a repetir.';

    const intervalSeconds = Number(args.interval_seconds);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
      return `interval_seconds tiene que ser un número de al menos ${MIN_INTERVAL_SECONDS}.`;
    }

    const repeatCount = Number(args.repeat_count);
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > MAX_REPEAT_COUNT) {
      return `repeat_count tiene que ser un entero entre 1 y ${MAX_REPEAT_COUNT}.`;
    }

    const startDelay = Number(args.start_delay_seconds) > 0 ? Number(args.start_delay_seconds) : 0;
    const runAt = addSeconds(nowLocal(), Math.max(startDelay, 1));

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    const id = remindersRepo.create(userId, {
      message,
      runAt,
      targetJid,
      categoryId,
      recurrenceFreq: 'none', // interval reminders manage their own cadence, not the daily/weekly/etc. system
      recurrenceInterval: 1,
      kind: 'interval',
      intervalSeconds,
      repeatCount,
      withAudio: Boolean(args.with_audio),
    });

    return (
      `⏰ Listo, quedó el recordatorio #${id}: "${message}" cada ${intervalSeconds}s, ${repeatCount} veces` +
      `${args.with_audio ? ' (con nota de voz)' : ''}. Dime "para" o "listo" en cualquier momento si quieres cancelarlo antes.`
    );
  },
};
