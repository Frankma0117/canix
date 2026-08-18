import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const listContactsTool: Tool = {
  name: 'list_contacts',
  description: 'Lista mis contactos guardados.',
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

    const contacts = contactsRepo.listAll(acting.userId);
    if (contacts.length === 0) return 'No hay contactos guardados todavía.';
    return contacts
      .map((c) => `#${c.id} ${c.name}${c.username ? ` (@${c.username})` : ''}${c.notes ? ` — ${c.notes}` : ''}`)
      .join('\n');
  },
};
