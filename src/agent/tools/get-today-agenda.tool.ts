import type { Tool } from '../tool-registry.js';
import { buildAgendaMessage } from '../agenda.js';

export const getTodayAgendaTool: Tool = {
  name: 'get_today_agenda',
  description:
    'Muestra la agenda de HOY ordenada por hora: rutinas, recordatorios y tareas de hoy, marcando qué rutinas ya se ' +
    'cumplieron y cuáles ya pasaron de hora sin marcar. Úsala cuando pregunten "qué tengo hoy", "cómo va mi día", ' +
    '"cuál es mi primera tarea/rutina", "qué me falta hoy", o algo similar - también sirve para ver qué quedó ' +
    'pendiente y ofrecer reprogramarlo el mismo día (con edit_routine/edit_todo/schedule_reminder).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    return buildAgendaMessage(ctx.userId);
  },
};
