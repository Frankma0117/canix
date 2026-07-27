import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { phoneToJid } from '../../util/jid.js';

export const addContactTool: Tool = {
  name: 'add_contact',
  description: 'Guarda un contacto (nombre + número) para poder enviarle mensajes por nombre después.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre del contacto.' },
      phone: { type: 'string', description: 'Número de WhatsApp (cualquier formato).' },
      notes: { type: 'string', description: 'Nota opcional sobre este contacto.' },
    },
    required: ['name', 'phone'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const name = String(args.name ?? '').trim();
    const phone = String(args.phone ?? '').trim();
    if (!name || !phone) return 'Error: falta nombre o número.';
    const contact = contactsRepo.upsert(ctx.userId, name, phoneToJid(phone), args.notes ? String(args.notes) : null);
    return `Contacto "${contact.name}" guardado (#${contact.id}).`;
  },
};
