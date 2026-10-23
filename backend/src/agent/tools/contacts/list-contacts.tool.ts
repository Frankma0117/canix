import { contactsView } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { contactsModel } from '../../../models/contacts.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const listContactsTool: Tool = {
  name: 'list_contacts',
  description: 'Lista mis contactos guardados. Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS contactos en vez de los tuyos.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const contacts = contactsModel.listAll(acting.userId);
    if (contacts.length === 0) return 'Todavía no tienes contactos guardados.';
    return contactsView(contacts);
  },
};
