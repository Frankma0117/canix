import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';

export const revokeAccessTool: Tool = {
  name: 'revoke_access',
  description:
    'Le quita el acceso al bot a alguien (solo el administrador). Borra toda su información ' +
    '(recordatorios, rutinas, contactos, etc.) — no se puede deshacer.',
  parameters: {
    type: 'object',
    properties: { name_or_phone: { type: 'string', description: 'Nombre o número de la persona.' } },
    required: ['name_or_phone'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede quitar acceso.';
    const query = String(args.name_or_phone ?? '').trim();
    if (!query) return 'Me falta el nombre o el número.';

    const matches = usersRepo.findByNameOrPhone(query).filter((u) => u.role !== 'admin'); // never removable via chat
    if (matches.length === 0) return `No encontré a nadie con acceso que coincida con "${query}".`;
    if (matches.length > 1) {
      return `Hay varias personas que coinciden con "${query}": ${matches.map((u) => u.name).join(', ')}. Sé más específico.`;
    }

    usersRepo.remove(matches[0].id);
    return `Listo, le quité el acceso a "${matches[0].name}" y borré su información.`;
  },
};
