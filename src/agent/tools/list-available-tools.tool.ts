import type { Tool } from '../tool-registry.js';
import { registry } from '../tool-registry.js';
import { ADMIN_ONLY_TOOLS } from './restricted-tools.js';

export const listAvailableToolsTool: Tool = {
  name: 'list_available_tools',
  description:
    'Lista todas las funciones/herramientas que existen, con su nombre exacto (solo el administrador). ' +
    'Úsala antes de set_user_permissions para saber qué nombres pasarle.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esto.';
    const assignable = registry.all().filter((t) => !ADMIN_ONLY_TOOLS.includes(t.name));
    return assignable.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  },
};
