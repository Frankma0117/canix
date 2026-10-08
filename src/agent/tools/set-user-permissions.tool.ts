import type { Tool } from '../tool-registry.js';
import { permissionsRepo, AccessError } from '../../db/repositories/permissions.repo.js';
import { effectivePermissions, describePermissions } from '../../permissions/engine.js';
import { resolveUserByQuery } from './resolve-user.js';

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

export const setUserPermissionsTool: Tool = {
  name: 'set_user_permissions',
  description:
    'Cambia lo que una persona puede usar (solo administrador). Modo "update" (default): suma/quita paquetes y ' +
    'permite/deniega/limpia permisos sueltos sin tocar lo demás. Modo "replace": deja EXACTAMENTE lo que pases ' +
    '(paquetes + allow + deny) y borra todo lo anterior. Lo denegado siempre gana sobre cualquier paquete. Usa ' +
    'list_permissions para las claves exactas.',
  parameters: {
    type: 'object',
    properties: {
      name_or_phone: { type: 'string', description: 'Nombre o número de la persona.' },
      mode: { type: 'string', enum: ['update', 'replace'], description: 'update (default) o replace.' },
      add_packages: { type: 'array', items: { type: 'string' }, description: 'Paquetes a asignar (clave, nombre o #id).' },
      remove_packages: { type: 'array', items: { type: 'string' }, description: 'Paquetes a quitar (solo modo update).' },
      allow: { type: 'array', items: { type: 'string' }, description: 'Claves de permiso a permitir.' },
      deny: { type: 'array', items: { type: 'string' }, description: 'Claves de permiso a denegar.' },
      clear: { type: 'array', items: { type: 'string' }, description: 'Claves de permiso cuyo permitido/denegado suelto se elimina (solo modo update).' },
    },
    required: ['name_or_phone'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede cambiar permisos.';
    const r = resolveUserByQuery(String(args.name_or_phone ?? ''));
    if ('error' in r) return r.error;
    const target = r.user;

    const resolvePkg = (ref: string) => {
      const pkg = permissionsRepo.getPackage(/^#?\d+$/.test(ref) ? Number(ref.replace('#', '')) : ref);
      if (!pkg) throw new AccessError(`No existe el paquete "${ref}" (mira list_permissions).`);
      return pkg.id;
    };

    try {
      const allow = strArray(args.allow);
      const deny = strArray(args.deny);
      if (args.mode === 'replace') {
        permissionsRepo.setUserAccess(ctx.userId, target.id, { packageIds: strArray(args.add_packages).map(resolvePkg), allow, deny });
      } else {
        // Build the complete new state, then write it in ONE transaction (all or nothing).
        const pkgIds = new Set(permissionsRepo.userPackages(target.id).map((p) => p.id));
        strArray(args.add_packages).map(resolvePkg).forEach((id) => pkgIds.add(id));
        strArray(args.remove_packages).map(resolvePkg).forEach((id) => pkgIds.delete(id));
        const overrides = new Map(permissionsRepo.userOverrides(target.id).map((o) => [o.permission_key, o.effect]));
        strArray(args.clear).forEach((k) => overrides.delete(k));
        allow.forEach((k) => overrides.set(k, 'allow'));
        deny.forEach((k) => overrides.set(k, 'deny'));
        permissionsRepo.setUserAccess(ctx.userId, target.id, {
          packageIds: [...pkgIds],
          allow: [...overrides].filter(([, e]) => e === 'allow').map(([k]) => k),
          deny: [...overrides].filter(([, e]) => e === 'deny').map(([k]) => k),
        });
      }
    } catch (err) {
      if (err instanceof AccessError) return err.message;
      throw err;
    }

    return `Listo. "${target.name}" ahora puede usar: ${describePermissions(effectivePermissions(target))}.`;
  },
};
