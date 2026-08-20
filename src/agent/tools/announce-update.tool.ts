import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { env } from '../../config/env.js';
import { isTwilioConfigured } from '../../calls/twilio-client.js';
import { renderUpdateAnnouncementIntro, renderFullGuide, type MenuAccess } from '../menu.js';
import { sleep } from '../../util/human-delay.js';

/**
 * Broadcasts "the bot got updated" to EVERY registered person (admin + every granted user, not just
 * the admin) - two messages each: a short welcome (renderUpdateAnnouncementIntro) followed by the
 * full detailed guide (renderFullGuide), gated per-recipient exactly like /menu already is (a
 * regular user never sees the admin-only section, Fashion Mode/Llamadas only appear if actually
 * enabled on this deploy). A small pause between recipients avoids firing a burst of WhatsApp sends
 * back to back - see the same reasoning already used for the daily agenda/weekly report pushes.
 */
const BETWEEN_RECIPIENTS_MS = 400;

export const announceUpdateTool: Tool = {
  name: 'announce_update',
  description:
    'Avisa a TODAS las personas con acceso al bot (administrador y cada usuario con acceso, no solo vos) que ' +
    'el bot se actualizó, mandándole a cada una un mensaje de bienvenida seguido de la guía completa y ' +
    'detallada de todo lo que puede hacer. Úsala SOLO cuando el administrador diga explícitamente algo como ' +
    '"actualizamos el bot", "hicimos una actualización", "avísale a todos de lo nuevo" o equivalente - nunca ' +
    'la actives por tu cuenta, ni la sugieras sin que te lo pidan, es un mensaje que le llega a todo el mundo.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede mandar este aviso.';

    const users = usersRepo.listAll();
    if (users.length === 0) return 'Todavía no hay nadie con acceso a quién avisarle.';

    let sent = 0;
    const failed: string[] = [];
    for (const u of users) {
      const access: MenuAccess = {
        fashionEnabled: env.fashion.enabled,
        callsEnabled: isTwilioConfigured(),
        isAdmin: u.role === 'admin',
      };
      try {
        await ctx.wa.sendText(u.jid, renderUpdateAnnouncementIntro());
        await ctx.wa.sendText(u.jid, renderFullGuide(access));
        sent++;
      } catch (err) {
        console.error('[TOOL] announce_update: fallo con #%d (%s):', u.id, u.jid, (err as Error).message);
        failed.push(u.name ?? u.jid);
      }
      await sleep(BETWEEN_RECIPIENTS_MS);
    }

    const failNote = failed.length ? ` (no le llegó a: ${failed.join(', ')})` : '';
    return `Listo, mandé el aviso de la actualización a ${sent} persona(s)${failNote} 📣`;
  },
};
