import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { phoneToJid } from '../../util/jid.js';

export const addContactTool: Tool = {
  name: 'add_contact',
  description:
    'Guarda un contacto (nombre + número) para poder enviarle mensajes por nombre después. ' +
    'Pide siempre el número CON indicativo de país (ej. 57 para Colombia) si no es obvio de dónde es.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre del contacto.' },
      phone: { type: 'string', description: 'Número de WhatsApp con indicativo de país (ej. 573001234567).' },
      notes: { type: 'string', description: 'Nota opcional sobre este contacto.' },
    },
    required: ['name', 'phone'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const name = String(args.name ?? '').trim();
    const phone = String(args.phone ?? '').trim();
    if (!name || !phone) return 'Error: falta nombre o número.';

    const jid = phoneToJid(phone);
    const contact = contactsRepo.upsert(ctx.userId, name, jid, args.notes ? String(args.notes) : null);

    // Best-effort right away: confirm the number is real, and cache its lid if it has one, so
    // sending to them later (even if they never write first) works from the get-go.
    const [exists] = await Promise.all([ctx.wa.checkOnWhatsApp(jid), ctx.wa.prefetchLid(jid)]);

    if (exists === false) {
      return (
        `Guardé a "${contact.name}" (#${contact.id}), pero ese número no parece tener WhatsApp. ` +
        'Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).'
      );
    }
    return `Contacto "${contact.name}" guardado (#${contact.id}).`;
  },
};
