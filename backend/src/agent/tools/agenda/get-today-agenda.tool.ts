import type { Tool } from '../../tool-registry.js';
import { renderAgenda } from '../../../services/agenda/agenda.service.js';
import { parseStrictDateTime } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const getTodayAgendaTool: Tool = {
  name: 'get_today_agenda',
  description:
    'Devuelve la agenda de un día (hoy por defecto, o la fecha que pases en date: mañana, el viernes, ayer...) ya ' +
    'diseñada para WhatsApp - envíala TAL CUAL, sin reescribirla. Úsala cuando pregunten "qué tengo hoy", "cómo va mi día", ' +
    '"cuál es mi primera tarea/rutina", "qué me falta hoy", o algo similar - también sirve para ver qué quedó ' +
    'pendiente y ofrecer reprogramarlo el mismo día (con edit_routine/edit_todo/schedule_reminder).',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: "Opcional: otro día en formato 'YYYY-MM-DD' (mañana, el viernes, ayer...). Default: hoy." },
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
    const date = args.date ? parseStrictDateTime(String(args.date))?.slice(0, 10) : undefined;
    if (args.date && !date) return `"${args.date}" no es una fecha válida (formato 'YYYY-MM-DD').`;
    return renderAgenda(acting.userId, date);
  },
};
