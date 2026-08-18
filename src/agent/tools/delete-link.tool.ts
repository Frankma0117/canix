import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteLinkTool: Tool = {
  name: 'delete_link',
  description:
    'Elimina un link por su id (usa list_links o search primero para confirmar cuál es antes de borrar).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del link a eliminar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU link en vez del tuyo.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const id = Number(args.id);
    const link = linksRepo.getById(userId, id);
    if (!link) return `No encontré el link #${id}.`;
    linksRepo.remove(userId, id);
    return `Link #${id} (${link.url}) eliminado.`;
  },
};
