import type { Tool } from '../tool-registry.js';
import { registry } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { ADMIN_ONLY_TOOLS } from './restricted-tools.js';

export const setUserPermissionsTool: Tool = {
  name: 'set_user_permissions',
  description:
    'Restringe a alguien con acceso al bot a solo un subconjunto de funciones (ej. "que Juan solo pueda guardar y ' +
    'ver recordatorios"), o le devuelve el acceso completo (solo el administrador). Usa list_available_tools ' +
    'primero para saber los nombres exactos de las funciones si no los tienes.',
  parameters: {
    type: 'object',
    properties: {
      name_or_phone: { type: 'string', description: 'Nombre o número de la persona.' },
      tool_names: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Nombres exactos de las funciones a permitirle (ver list_available_tools). Pasa ["all"] para quitar toda restricción y darle acceso completo.',
      },
    },
    required: ['name_or_phone', 'tool_names'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede cambiar permisos.';
    const query = String(args.name_or_phone ?? '').trim();
    if (!query) return 'Me falta el nombre o el número.';

    const matches = usersRepo.findByNameOrPhone(query).filter((u) => u.role !== 'admin');
    if (matches.length === 0) return `No encontré a nadie con acceso que coincida con "${query}".`;
    if (matches.length > 1) {
      return `Hay varias personas que coinciden con "${query}": ${matches.map((u) => u.name).join(', ')}. Sé más específico.`;
    }
    const target = matches[0];

    const requested = Array.isArray(args.tool_names) ? (args.tool_names as unknown[]).map(String) : [];
    if (requested.length === 0) return 'Me falta la lista de tool_names (o ["all"] para acceso completo).';

    if (requested.length === 1 && requested[0] === 'all') {
      usersRepo.setAllowedTools(target.id, null);
      return `Listo, "${target.name}" ahora tiene acceso completo a todas las funciones.`;
    }

    const valid = new Set(registry.names());
    const invalid = requested.filter((t) => !valid.has(t) || ADMIN_ONLY_TOOLS.includes(t));
    const allowed = requested.filter((t) => valid.has(t) && !ADMIN_ONLY_TOOLS.includes(t));

    if (allowed.length === 0) {
      return `Ninguno de esos nombres es válido: ${requested.join(', ')}. Usa list_available_tools para ver los nombres exactos.`;
    }

    usersRepo.setAllowedTools(target.id, allowed);
    const invalidNote = invalid.length ? ` (ignorados por no ser válidos: ${invalid.join(', ')})` : '';
    return `Listo, "${target.name}" ahora solo puede usar: ${allowed.join(', ')}${invalidNote}.`;
  },
};
