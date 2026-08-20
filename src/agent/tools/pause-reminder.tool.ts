import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { addDays, nowLocal } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';

export const pauseReminderTool: Tool = {
  name: 'pause_reminder',
  description:
    'Pausa un recordatorio puntual por un número de días sin cancelarlo ni borrarlo - vuelve a avisar normalmente ' +
    'cuando pase ese tiempo (o antes con resume_reminder). Para rutinas usa pause_routine, no esta - esta no sirve ' +
    'para los recordatorios internos de una rutina, ni para uno de intervalo (esos solo se cancelan/borran).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del recordatorio a pausar.' },
      days: { type: 'number', description: 'Cuántos días pausar (entero mayor a 0).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para pausarle su recordatorio en vez del tuyo.',
      },
    },
    required: ['id', 'days'],
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
      return `#${id} es parte de una rutina - usa pause_routine (id de la rutina, no del recordatorio) para pausarla.`;
    }
    if (reminder.kind === 'interval') {
      return `#${id} es un recordatorio de intervalo (ciclo corto) - esos no se pausan, usa cancel_reminder o delete_reminder si quieres detenerlo.`;
    }

    const days = Number(args.days);
    if (!Number.isFinite(days) || days <= 0) return 'Los días tienen que ser un número mayor a 0.';

    const until = addDays(nowLocal(), days);
    remindersRepo.setPausedUntil(userId, id, until);
    return `🔕 Listo, pausé el recordatorio #${id} hasta ${until.slice(0, 10)}.`;
  },
};
