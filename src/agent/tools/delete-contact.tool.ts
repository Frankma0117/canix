import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const deleteContactTool: Tool = {
  name: 'delete_contact',
  description: 'Elimina un contacto guardado, por su id (usa list_contacts primero para confirmar cuál es).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del contacto a eliminar.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para borrar SU contacto en vez del tuyo.',
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
    const contact = contactsRepo.getById(userId, id);
    if (!contact) return `No encontré el contacto #${id}.`;
    contactsRepo.remove(userId, id);
    return `Contacto "${contact.name}" eliminado.`;
  },
};
