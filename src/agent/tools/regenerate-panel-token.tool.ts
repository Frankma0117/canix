import { randomBytes } from 'node:crypto';
import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';

export const regeneratePanelTokenTool: Tool = {
  name: 'regenerate_panel_token',
  description:
    'Genera un nuevo token del panel web (invalida el anterior). Cualquiera puede regenerar el suyo propio (déjalo ' +
    'vacío); regenerar el de otra persona es solo para el administrador.',
  parameters: {
    type: 'object',
    properties: { name_or_phone: { type: 'string', description: 'Nombre o número de la persona (vacío = tú mismo).' } },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const query = String(args.name_or_phone ?? '').trim();

    if (!query) {
      const token = randomBytes(24).toString('hex');
      usersRepo.setPanelToken(ctx.userId, token);
      return `Listo, ya tienes token nuevo para tu panel: ${token} (el anterior ya no sirve).`;
    }

    if (!ctx.isAdmin) return 'Solo el administrador puede regenerar el token de otra persona.';
    const target = usersRepo.findByNameOrPhone(query)[0];
    if (!target) return `No encontré a nadie con acceso que coincida con "${query}".`;

    const token = randomBytes(24).toString('hex');
    usersRepo.setPanelToken(target.id, token);
    return `Listo, token nuevo del panel para "${target.name}": ${token} (el anterior ya no sirve).`;
  },
};
