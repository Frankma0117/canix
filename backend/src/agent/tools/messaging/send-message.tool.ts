import type { Tool } from '../../tool-registry.js';
import { contactsModel } from '../../../models/contacts.model.js';
import { usersModel } from '../../../models/users.model.js';
import { phoneToJid, normalizePhoneDigits, isJid } from '../../../shared/utils/jid.js';
import { checkBudget, recordSend } from '../../../channels/whatsapp/send-guard.js';
import { env } from '../../../config/env.js';

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
    if (!to || !message) return 'Me falta el destinatario o el mensaje.';

    let targetJid: string;
    let isNewRawNumber = false;
    if (isJid(to)) {
      targetJid = to;
    } else if (to.startsWith('@')) {
      // WhatsApp's public @username handle: only resolvable against a contact YOU already saved
      // with that username label (add_contact) - the installed WhatsApp library doesn't yet expose
      // a way to resolve an arbitrary username straight to a jid, so a cold "@alguien" with no
      // saved match can't be sent, only reported honestly instead of silently failing.
      const byUsername = contactsModel.getByUsername(ctx.userId, to.slice(1));
      if (!byUsername) {
        return (
          `No tengo guardado un contacto con el username "${to}". Todavía no puedo mandarle el primer mensaje ` +
          'a alguien solo por su @username (WhatsApp no lo permite todavía desde acá) - dame su número o ' +
          'guárdalo primero con add_contact (nombre + número, el username es solo una etiqueta).'
        );
      }
      targetJid = contactsModel.sendTarget(byUsername);
    } else {
      const matches = contactsModel.findByName(ctx.userId, to);
      if (matches.length === 1) {
        targetJid = contactsModel.sendTarget(matches[0]);
      } else if (matches.length > 1) {
        return `Hay varios contactos que coinciden con "${to}": ${matches.map((m) => m.name).join(', ')}. Sé más específico.`;
      } else if (/^[\d\s()+-]{6,}$/.test(to)) {
        isNewRawNumber = true;
        // A saved contact (or an explicit jid) was already validated when it was added/first seen -
        // but a raw number just typed may be fake or incomplete, and sendText() doesn't necessarily
        // fail for it (WhatsApp can silently swallow a send to a bad jid), so it's checked first with
        // onWhatsApp(). IMPORTANT: the jid that lookup returns is NOT used to send or to save the
        // contact - sometimes it's an @lid instead of an @s.whatsapp.net, and a lid resolved that way
        // (not learned from that person's real traffic) is exactly what once broke "cold" sends (see
        // prefetchLid in wa-manager.ts): WhatsApp accepts it without error but the message never
        // arrives, and if it were saved as the contact's jid every future send "by name" would inherit
        // the same silent problem. Only `exists` is used (to warn about an invalid number); the real
        // jid is always phoneToJid().
        const digits = normalizePhoneDigits(to);
        const resolved = await ctx.wa.resolveOnWhatsApp(digits);
        if (resolved?.exists === false) {
          return `Ese número (${to}) no parece tener WhatsApp. Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).`;
        }
        targetJid = phoneToJid(to);
        console.log(
          '[TOOL] send_message: number %s -> jid=%s (verified=%s)',
          to,
          targetJid,
          resolved ? 'yes' : 'could not verify',
        );
      } else {
        return `No encontré ningún contacto llamado "${to}". Guárdalo primero con add_contact o dame su número.`;
      }
    }

    // "Cold" = the target has never written to this bot (not a registered user) - the riskiest
    // pattern for a WhatsApp number (see channels/whatsapp/send-guard.ts), so it gets its own, much lower
    // daily cap + minimum spacing on top of the general connection health checks above. A message
    // to someone who already uses the bot (a registered user) is a warm, established conversation
    // and isn't gated here at all.
    const isCold = !usersModel.getByJidOrLid(targetJid);
    if (isCold) {
      const budget = checkBudget('cold', env.wa.session);
      if (!budget.ok) return `${budget.reason} Intenta de nuevo más tarde.`;
    }

    console.log('[TOOL] send_message: sending to %s...', targetJid);
    try {
      await ctx.wa.sendText(targetJid, message);
      if (isCold) recordSend('cold', targetJid);
      console.log('[TOOL] send_message: sock.sendMessage() confirmed the send to %s without error.', targetJid);
    } catch (err) {
      console.error('[TOOL] send_message: sending to %s failed:', targetJid, (err as Error).message);
      return `No pude enviarle el mensaje a ${to}: ${(err as Error).message}`;
    }

    // First time writing to a raw number that worked - save it as a contact so it's easy to
    // reach again by name/number next time, instead of a one-off. IMPORTANT: only when this jid
    // truly has no contact yet. `isNewRawNumber` only means "not found by NAME" - searching by name
    // with a string of digits as the query can never match a real name, so this branch is reached
    // for EVERY raw-number send, including one to someone who already has a properly-named contact
    // (found some other way, e.g. picked from a shared vCard). Upserting there unconditionally used
    // to silently rename that contact to the raw digits - contacts.model.ts's upsert() always
    // overwrites `name` on conflict, and this was called with `to` (the raw phone string) as the
    // name every single time. Checking for an existing row by jid first is what actually fixes it.
    if (isNewRawNumber && !contactsModel.getByJid(ctx.userId, targetJid)) {
      contactsModel.upsert(ctx.userId, to, targetJid, null);
    }

    return `Listo, le mandé el mensaje a ${to} 👍`;
  },
};
