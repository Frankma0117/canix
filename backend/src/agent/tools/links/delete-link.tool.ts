import type { Tool } from '../../tool-registry.js';
import { linksModel } from '../../../models/links.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

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
    const link = linksModel.getById(userId, id);
    if (!link) return `No encontré el link ⟦${id}⟧.`;
    linksModel.remove(userId, id);
    return `Listo, borré el link ⟦${id}⟧ (${link.url}).`;
  },
};
