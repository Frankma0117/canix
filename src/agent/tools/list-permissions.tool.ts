import type { Tool } from '../tool-registry.js';
import { PERMISSIONS } from '../../permissions/catalog.js';
import { permissionsRepo } from '../../db/repositories/permissions.repo.js';

export const listPermissionsTool: Tool = {
  name: 'list_permissions',
  description:
    'Muestra el catálogo de permisos (cada funcionalidad del bot, con su clave exacta) y los paquetes existentes con ' +
    'lo que incluye cada uno (solo administrador). Úsala antes de set_user_permissions o manage_permission_package.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esto.';
    const byModule = new Map<string, string[]>();
    for (const p of PERMISSIONS) {
      byModule.set(p.module, [...(byModule.get(p.module) ?? []), `  - ${p.key}: ${p.label} - ${p.description}`]);
    }
    const catalog = [...byModule].map(([module, lines]) => `${module}:\n${lines.join('\n')}`).join('\n');
    const packages = permissionsRepo
      .listPackages()
      .map((p) => `  - #${p.id} "${p.name}" (clave ${p.key}${p.is_system ? ', del sistema' : ''}): ${p.permissions.join(', ') || '(vacío)'}`)
      .join('\n');
    return `PERMISOS:\n${catalog}\n\nPAQUETES:\n${packages}`;
  },
};
