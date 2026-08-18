import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { addDays, nowLocal } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';

export const pauseNotificationsTool: Tool = {
  name: 'pause_notifications',
  description:
    'Pausa TODOS los avisos (rutinas, recordatorios, agenda del día, todo lo agendado) por un número de días - ' +
    'nada se envía mientras esté pausado, y todo vuelve solo a la normalidad cuando pase ese tiempo (o antes con ' +
    'resume_notifications). Los recordatorios que se repiten (rutinas, agenda) simplemente se saltan las ocurrencias ' +
    'durante la pausa, sin acumularse. Un recordatorio de una sola vez que caiga en la pausa se manda apenas termine.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Cuántos días pausar (entero mayor a 0).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para pausarle a ella en vez de a ti.',
      },
    },
    required: ['days'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const days = Number(args.days);
    if (!Number.isFinite(days) || days <= 0) return 'Error: days debe ser un número mayor a 0.';

    const until = addDays(nowLocal(), days);
    usersRepo.setPausedUntil(acting.userId, until);
    return `🔕 Notificaciones pausadas hasta ${until.slice(0, 10)}. Nada se enviará hasta entonces (o antes si pides resume_notifications).`;
  },
};
