import type { Tool } from '../tool-registry.js';
import { notesRepo } from '../../db/repositories/notes.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteNoteTool: Tool = {
  name: 'delete_note',
  description: 'Elimina una nota guardada, por su id (usa list_notes primero para confirmar cuál es).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la nota a eliminar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU nota en vez de la tuya.',
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
    const note = notesRepo.getById(userId, id);
    if (!note) return `No encontré la nota #${id}.`;
    notesRepo.remove(userId, id);
    return `Listo, borré la nota #${id}.`;
  },
};
