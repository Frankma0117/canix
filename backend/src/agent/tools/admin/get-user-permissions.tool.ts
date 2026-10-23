import type { Tool } from '../../tool-registry.js';
import { permissionsModel } from '../../../models/permissions.model.js';
import { effectivePermissions, describePermissions } from '../../../services/permissions/permissions.service.js';
import { resolveUserByQuery } from '../shared/resolve-user.js';
import { describeIdentity } from '../../../shared/utils/jid.js';

export const getUserPermissionsTool: Tool = {
  name: 'get_user_permissions',
  description: 'Muestra qué puede usar una persona y por qué: sus paquetes, permisos sueltos permitidos/denegados y el resultado final (solo administrador).',
  parameters: {
    type: 'object',
    properties: { name_or_phone: { type: 'string', description: 'Nombre o número de la persona.' } },
    required: ['name_or_phone'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esto.';
    const r = resolveUserByQuery(String(args.name_or_phone ?? ''));
    if ('error' in r) return r.error;
    const u = r.user;
    const pkgs = permissionsModel.userPackages(u.id);
    const overrides = permissionsModel.userOverrides(u.id);
    const allow = overrides.filter((o) => o.effect === 'allow').map((o) => o.permission_key);
    const deny = overrides.filter((o) => o.effect === 'deny').map((o) => o.permission_key);
    const effective = effectivePermissions(u);
    return [
      `${u.name ?? '(sin nombre)'} (⟦${u.id}⟧, ${describeIdentity(u.jid).label}):`,
      `- Paquetes: ${pkgs.map((p) => `"${p.name}"`).join(', ') || '(ninguno)'}`,
      `- Permitidos sueltos: ${allow.join(', ') || '(ninguno)'}`,
      `- Denegados: ${deny.join(', ') || '(ninguno)'}`,
      `- Resultado final: ${describePermissions(effective)}`,
      `- Portal web: ${effective.has('portal.access') ? (u.password_hash ? 'sí (tiene contraseña)' : 'permitido, pero aún sin contraseña (usa set_web_password)') : 'no'}`,
    ].join('\n');
  },
};
