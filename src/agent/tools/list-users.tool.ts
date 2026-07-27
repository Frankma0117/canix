import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';

export const listUsersTool: Tool = {
  name: 'list_users',
  description: 'Lista quién tiene acceso al bot (solo el administrador).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esta lista.';
    const users = usersRepo.listAll();
    if (users.length === 0) return 'No hay usuarios registrados.';
    return users
      .map((u) => `#${u.id} ${u.name ?? '(sin nombre)'}${u.role === 'admin' ? ' — administrador' : ''}`)
      .join('\n');
  },
};
