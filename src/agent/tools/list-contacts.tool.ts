import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';

export const listContactsTool: Tool = {
  name: 'list_contacts',
  description: 'Lista mis contactos guardados.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    const contacts = contactsRepo.listAll(ctx.userId);
    if (contacts.length === 0) return 'No hay contactos guardados todavía.';
    return contacts.map((c) => `#${c.id} ${c.name}${c.notes ? ` — ${c.notes}` : ''}`).join('\n');
  },
};
