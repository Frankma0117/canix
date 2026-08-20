import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { phoneToJid } from '../../util/jid.js';
import { resolveActingUser } from './act-on-behalf.js';

export const addContactTool: Tool = {
  name: 'add_contact',
  description:
    'Guarda un contacto (nombre + número) para poder enviarle mensajes por nombre después. ' +
    'Pide siempre el número CON indicativo de país (ej. 57 para Colombia) si no es obvio de dónde es. ' +
    'Opcionalmente guarda también su @username de WhatsApp (el identificador público nuevo de WhatsApp) como ' +
    'referencia/etiqueta para buscarlo - el envío real sigue siempre por número, WhatsApp todavía no expone una ' +
    'forma de mandar el primer mensaje solo con el username.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre del contacto.' },
      phone: { type: 'string', description: 'Número de WhatsApp con indicativo de país (ej. 573001234567).' },
      username: { type: 'string', description: 'Su @username de WhatsApp, si lo tiene (sin el @). Opcional.' },
      notes: { type: 'string', description: 'Nota opcional sobre este contacto.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para guardárselo a ella en vez de a ti.',
      },
    },
    required: ['name', 'phone'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const name = String(args.name ?? '').trim();
    const phone = String(args.phone ?? '').trim();
    if (!name || !phone) return 'Me falta el nombre o el número del contacto.';
    const username = args.username ? String(args.username).trim().replace(/^@/, '') : null;

    const jid = phoneToJid(phone);
    const contact = contactsRepo.upsert(userId, name, jid, args.notes ? String(args.notes) : null, username);

    // Best-effort right away: confirm the number is real, and cache its lid if it has one, so
    // sending to them later (even if they never write first) works from the get-go.
    const [exists, lid] = await Promise.all([ctx.wa.checkOnWhatsApp(jid), ctx.wa.prefetchLid(jid)]);
    console.log(
      '[TOOL] add_contact: verificacion de "%s" (%s) -> existe=%s, lid=%s',
      name,
      jid,
      exists === null ? 'no se pudo verificar' : exists,
      lid ?? '(no encontrado)',
    );

    if (exists === false) {
      return (
        `Guardé a "${contact.name}" (#${contact.id}), pero ese número no parece tener WhatsApp. ` +
        'Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).'
      );
    }
    return `Listo, guardé el contacto "${contact.name}" (#${contact.id}) 👍`;
  },
};
