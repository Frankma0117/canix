import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { phoneToJid } from '../../util/jid.js';

export const grantAccessTool: Tool = {
  name: 'grant_access',
  description:
    'Le da acceso al bot a otra persona (solo el administrador puede usar esto). Cada persona tiene su propia ' +
    'configuración, recordatorios, rutinas, contactos, etc. — completamente separados, nada se comparte entre usuarios.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Número de WhatsApp de la persona (cualquier formato).' },
      name: { type: 'string', description: 'Nombre de la persona.' },
    },
    required: ['phone', 'name'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede dar acceso a otras personas.';
    const phone = String(args.phone ?? '').trim();
    const name = String(args.name ?? '').trim();
    if (!phone || !name) return 'Error: falta el número o el nombre.';

    const jid = phoneToJid(phone);
    const user = usersRepo.create({ jid, name, role: 'user' });
    return `Listo, "${user.name}" ya tiene acceso al bot con su propia configuración (#${user.id}).`;
  },
};
