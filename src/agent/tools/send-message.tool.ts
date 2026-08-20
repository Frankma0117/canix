import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { phoneToJid, normalizePhoneDigits, isJid } from '../../util/jid.js';

export const sendMessageTool: Tool = {
  name: 'send_message',
  description:
    'Envía un mensaje de WhatsApp a alguien (busca primero por nombre en mis contactos, o usa un número directo). ' +
    'Funciona con cualquier número real de WhatsApp, le haya escrito antes al bot o no.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Nombre de un contacto guardado, o número de teléfono con indicativo.' },
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
    let isNewRawNumber = false;
    if (isJid(to)) {
      targetJid = to;
    } else if (to.startsWith('@')) {
      // WhatsApp's public @username handle: only resolvable against a contact YOU already saved
      // with that username label (add_contact) - the installed WhatsApp library doesn't yet expose
      // a way to resolve an arbitrary username straight to a jid, so a cold "@alguien" with no
      // saved match can't be sent, only reported honestly instead of silently failing.
      const byUsername = contactsRepo.getByUsername(ctx.userId, to.slice(1));
      if (!byUsername) {
        return (
          `No tengo guardado un contacto con el username "${to}". Todavía no puedo mandarle el primer mensaje ` +
          'a alguien solo por su @username (WhatsApp no lo permite todavía desde acá) - dame su número o ' +
          'guárdalo primero con add_contact (nombre + número, el username es solo una etiqueta).'
        );
      }
      targetJid = contactsRepo.sendTarget(byUsername);
    } else {
      const matches = contactsRepo.findByName(ctx.userId, to);
      if (matches.length === 1) {
        targetJid = contactsRepo.sendTarget(matches[0]);
      } else if (matches.length > 1) {
        return `Hay varios contactos que coinciden con "${to}": ${matches.map((m) => m.name).join(', ')}. Sé más específico.`;
      } else if (/^[\d\s()+-]{6,}$/.test(to)) {
        isNewRawNumber = true;
        // Un contacto guardado (o un jid explícito) ya quedó validado cuando se agregó/se vio por
        // primera vez - pero un número crudo recién escrito puede no ser real o estar incompleto,
        // y sendText() no necesariamente falla por eso (WhatsApp puede tragarse en silencio un
        // envío a un jid malo). Se verifica primero con onWhatsApp() y se usa el jid NORMALIZADO
        // que esa consulta devuelve (puede ser un @lid en vez de @s.whatsapp.net) en vez de armarlo
        // a mano - si la consulta en sí falla (socket caído, etc.) se sigue con el jid armado a
        // mano en vez de bloquear el envío solo porque la verificación no se pudo hacer.
        const digits = normalizePhoneDigits(to);
        const resolved = await ctx.wa.resolveOnWhatsApp(digits);
        if (resolved?.exists === false) {
          return `Ese número (${to}) no parece tener WhatsApp. Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).`;
        }
        targetJid = resolved?.jid ?? phoneToJid(to);
        console.log(
          '[TOOL] send_message: número %s -> jid=%s (verificado=%s)',
          to,
          targetJid,
          resolved ? 'sí' : 'no se pudo verificar',
        );
      } else {
        return `No encontré ningún contacto llamado "${to}". Guárdalo primero con add_contact o dame su número.`;
      }
    }

    console.log('[TOOL] send_message: enviando a %s...', targetJid);
    try {
      await ctx.wa.sendText(targetJid, message);
      console.log('[TOOL] send_message: sock.sendMessage() confirmo el envio a %s sin error.', targetJid);
    } catch (err) {
      console.error('[TOOL] send_message: fallo el envio a %s:', targetJid, (err as Error).message);
      return `No se pudo enviar el mensaje a ${to}: ${(err as Error).message}`;
    }

    // First time writing to a raw number that worked - save it as a contact so it's easy to
    // reach again by name/number next time, instead of a one-off.
    if (isNewRawNumber) {
      contactsRepo.upsert(ctx.userId, to, targetJid, null);
    }

    return `Mensaje enviado a ${to}.`;
  },
};
