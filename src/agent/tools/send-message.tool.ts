import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { phoneToJid, isJid } from '../../util/jid.js';

export const sendMessageTool: Tool = {
  name: 'send_message',
  description:
    'Envía un mensaje de WhatsApp a alguien (busca primero por nombre en mis contactos, o usa un número directo).',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Nombre de un contacto guardado, o número de teléfono.' },
      message: { type: 'string', description: 'Texto a enviar.' },
    },
    required: ['to', 'message'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const to = String(args.to ?? '').trim();
    const message = String(args.message ?? '').trim();
    if (!to || !message) return 'Error: falta destinatario o mensaje.';

    let targetJid: string;
    if (isJid(to)) {
      targetJid = to;
    } else {
      const matches = contactsRepo.findByName(to);
      if (matches.length === 1) {
        targetJid = matches[0].jid;
      } else if (matches.length > 1) {
        return `Hay varios contactos que coinciden con "${to}": ${matches.map((m) => m.name).join(', ')}. Sé más específico.`;
      } else if (/^[\d\s()+-]{6,}$/.test(to)) {
        targetJid = phoneToJid(to);
      } else {
        return `No encontré ningún contacto llamado "${to}". Guárdalo primero con add_contact o dame su número.`;
      }
    }

    await ctx.wa.sendText(targetJid, message);
    return `Mensaje enviado a ${to}.`;
  },
};
