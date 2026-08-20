import type { Tool } from '../tool-registry.js';
import { setRoutinePaused } from '../routine-setup.js';
import { resolveActingUser } from './act-on-behalf.js';

export const resumeRoutineTool: Tool = {
  name: 'resume_routine',
  description: 'Reanuda de inmediato una rutina pausada con pause_routine, antes de que se cumplan los días.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para reanudarle su rutina en vez de la tuya.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const id = Number(args.id);
    const ok = setRoutinePaused(acting.userId, id, null);
    if (!ok) return `No encontré la rutina #${id}.`;
    return `🔔 Listo, reanudé la rutina #${id}.`;
  },
};
