import type { Tool } from '../tool-registry.js';
import { buildWeeklyReportMessage } from '../weekly-report.js';
import { resolveActingUser } from './act-on-behalf.js';

export const getWeekReportTool: Tool = {
  name: 'get_week_report',
  description:
    'Muestra el resumen de la semana (últimos 7 días): por cada rutina cuántos días se cumplió y la racha actual, ' +
    'y de las tareas de una sola vez cuántas se cumplieron esta semana vs cuántas siguen pendientes. Úsala cuando ' +
    'pregunten "cómo me fue esta semana", "cuánto he cumplido", o algo similar - no la inventes de memoria.',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SU semana en vez de la tuya.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    return buildWeeklyReportMessage(acting.userId);
  },
};
