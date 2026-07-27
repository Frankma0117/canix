import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';

export const deleteContactTool: Tool = {
  name: 'delete_contact',
  description: 'Elimina un contacto guardado, por su id (usa list_contacts primero para confirmar cuál es).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id del contacto a eliminar.' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const contact = contactsRepo.getById(ctx.userId, id);
    if (!contact) return `No encontré el contacto #${id}.`;
    contactsRepo.remove(ctx.userId, id);
    return `Contacto "${contact.name}" eliminado.`;
  },
};
