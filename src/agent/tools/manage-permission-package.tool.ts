import type { Tool } from '../tool-registry.js';
import { permissionsRepo, AccessError } from '../../db/repositories/permissions.repo.js';

export const managePermissionPackageTool: Tool = {
  name: 'manage_permission_package',
  description:
    'Crea, edita o borra un paquete de permisos (solo administrador). Al editar, "permissions" reemplaza la lista ' +
    'completa del paquete. Los paquetes del sistema se pueden editar pero no borrar.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete'] },
      package: { type: 'string', description: 'Para update/delete: clave, nombre o #id del paquete.' },
      name: { type: 'string', description: 'Nombre (create, o nuevo nombre en update).' },
      description: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' }, description: 'Claves de permiso que incluye (ver list_permissions).' },
    },
    required: ['action'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede gestionar paquetes.';
    const perms = Array.isArray(args.permissions) ? args.permissions.map(String) : undefined;
    try {
      if (args.action === 'create') {
        if (!args.name) return 'Me falta el nombre del paquete.';
        const pkg = permissionsRepo.savePackage(ctx.userId, {
          name: String(args.name),
          description: args.description ? String(args.description) : '',
          permissions: perms ?? [],
        });
        return `Listo, creé el paquete #${pkg.id} "${pkg.name}" con: ${pkg.permissions.join(', ') || '(vacío)'}.`;
      }

      const ref = String(args.package ?? '').trim();
      const existing = permissionsRepo.getPackage(/^#?\d+$/.test(ref) ? Number(ref.replace('#', '')) : ref);
      if (!existing) return `No encontré el paquete "${ref}" (mira list_permissions).`;

      if (args.action === 'delete') {
        permissionsRepo.deletePackage(ctx.userId, existing.id);
        return `Listo, borré el paquete "${existing.name}" (quien lo tenía asignado ya no recibe sus permisos).`;
      }

      const pkg = permissionsRepo.savePackage(ctx.userId, {
        id: existing.id,
        name: args.name ? String(args.name) : existing.name,
        description: args.description !== undefined ? String(args.description) : existing.description,
        permissions: perms ?? existing.permissions,
      });
      return `Listo, el paquete "${pkg.name}" ahora incluye: ${pkg.permissions.join(', ') || '(vacío)'}.`;
    } catch (err) {
      if (err instanceof AccessError) return err.message;
      throw err;
    }
  },
};
