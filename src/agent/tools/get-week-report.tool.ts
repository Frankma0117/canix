import type { Tool } from '../tool-registry.js';
import { buildWeeklyReportMessage } from '../weekly-report.js';

export const getWeekReportTool: Tool = {
  name: 'get_week_report',
  description:
    'Muestra el resumen de la semana (últimos 7 días): por cada rutina cuántos días se cumplió y la racha actual, ' +
    'y de las tareas de una sola vez cuántas se cumplieron esta semana vs cuántas siguen pendientes. Úsala cuando ' +
    'pregunten "cómo me fue esta semana", "cuánto he cumplido", o algo similar - no la inventes de memoria.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    return buildWeeklyReportMessage(ctx.userId);
  },
};
