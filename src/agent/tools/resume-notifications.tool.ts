import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const resumeNotificationsTool: Tool = {
  name: 'resume_notifications',
  description: 'Reanuda de inmediato todos los avisos si estaban pausados con pause_notifications, antes de que se cumplan los días.',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para reanudarle a ella en vez de a ti.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const user = usersRepo.getById(acting.userId);
    if (!user?.paused_until) return 'No tenías notificaciones pausadas.';
    usersRepo.setPausedUntil(acting.userId, null);
    return '🔔 Notificaciones reanudadas.';
  },
};
