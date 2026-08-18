import type { Tool } from '../tool-registry.js';
import { setRoutinePaused } from '../routine-setup.js';
import { addDays, nowLocal } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';

export const pauseRoutineTool: Tool = {
  name: 'pause_routine',
  description:
    'Pausa una rutina/hábito por un número de días (ej. vacaciones, lesión) sin borrarla ni perder su racha/historial - ' +
    'no avisa ni pide chequeo mientras esté pausada, y vuelve a avisar normalmente cuando pase ese tiempo (o antes con resume_routine).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la rutina (ver list_todos con scope routine).' },
      days: { type: 'number', description: 'Cuántos días pausar (entero mayor a 0).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para pausarle su rutina en vez de la tuya.',
      },
    },
    required: ['id', 'days'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const days = Number(args.days);
    if (!Number.isFinite(days) || days <= 0) return 'Error: days debe ser un número mayor a 0.';

    const id = Number(args.id);
    const until = addDays(nowLocal(), days);
    const ok = setRoutinePaused(acting.userId, id, until);
    if (!ok) return `No encontré la rutina #${id}.`;
    return `🔕 Rutina #${id} pausada hasta ${until.slice(0, 10)} (no avisa ni pide chequeo mientras tanto).`;
  },
};
