import type { Tool } from '../tool-registry.js';
import { buildAgendaMessage } from '../agenda.js';
import { resolveActingUser } from './act-on-behalf.js';

export const getTodayAgendaTool: Tool = {
  name: 'get_today_agenda',
  description:
    'Muestra la agenda de HOY ordenada por hora: rutinas, recordatorios y tareas de hoy, marcando qué rutinas ya se ' +
    'cumplieron y cuáles ya pasaron de hora sin marcar. Úsala cuando pregunten "qué tengo hoy", "cómo va mi día", ' +
    '"cuál es mi primera tarea/rutina", "qué me falta hoy", o algo similar - también sirve para ver qué quedó ' +
    'pendiente y ofrecer reprogramarlo el mismo día (con edit_routine/edit_todo/schedule_reminder).',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SU agenda en vez de la tuya.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    return buildAgendaMessage(acting.userId);
  },
};
