import type { Tool } from '../tool-registry.js';
import { issueTemporaryPassword } from '../../auth/web-auth.js';
import { can } from '../../permissions/engine.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { env } from '../../config/env.js';
import { resolveUserByQuery } from './resolve-user.js';
import { describeIdentity } from '../../util/jid.js';
import type { User } from '../../types/index.js';

/** "Entra a https://... con tu número 573001234567 y esta contraseña temporal: ..." - or, for
 *  someone whose real number WhatsApp hasn't shared yet, with their access code instead. */
export function portalAccessMessage(jid: string, password: string): string {
  const where = env.panelUrl ? `Entra a ${env.panelUrl}` : 'Entra al portal web';
  const { phone, code } = describeIdentity(jid);
  const who = phone
    ? `con tu número *${phone}*`
    : `con este código de acceso en el campo del número: *${code}* (WhatsApp todavía no me ha compartido tu número; ` +
      'en cuanto me escribas de nuevo lo registro y podrás entrar con tu número normal)';
  return `🔐 ${where} ${who} y esta contraseña temporal: *${password}*\n\nAl entrar te voy a pedir que la cambies por una tuya.`;
}

/** If this person is still stored under their @lid, asks WhatsApp for the real number and keeps it. */
export async function healPhone(user: User, resolve: (lid: string) => Promise<string | null>): Promise<User> {
  if (!user.jid.endsWith('@lid')) return user;
  const resolved = await resolve(user.jid).catch(() => null);
  if (!resolved?.endsWith('@s.whatsapp.net')) return user;
  const phoneJid = resolved.replace(/:\d+@/, '@'); // drop any ":<device>" suffix
  if (usersRepo.setPhoneJid(user.id, phoneJid)) {
    console.log('[AUTH] Usuario #%d: número real %s registrado.', user.id, phoneJid);
    return usersRepo.getById(user.id) ?? user;
  }
  return user;
}

export const setWebPasswordTool: Tool = {
  name: 'set_web_password',
  description:
    'Le crea a una persona (o a ti mismo, sin nombre) una contraseña TEMPORAL del portal web y se la envía por ' +
    'WhatsApp; el portal le pide cambiarla al entrar. Cierra sus sesiones abiertas. Solo administrador.',
  parameters: {
    type: 'object',
    properties: { name_or_phone: { type: 'string', description: 'Nombre o número (vacío = tú mismo).' } },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede asignar contraseñas a otras personas.';
    const query = String(args.name_or_phone ?? '').trim();
    let target = usersRepo.getById(ctx.userId)!;
    if (query) {
      const r = resolveUserByQuery(query, { allowAdmin: true });
      if ('error' in r) return r.error;
      target = r.user;
    }
    target = await healPhone(target, (lid) => ctx.wa.resolveLidToPhoneJid(lid));
    const pwd = await issueTemporaryPassword(target.id, ctx.userId);
    const note = can(target, 'portal.access') ? '' : ' OJO: todavía no tiene el permiso portal.access, así que no podrá entrar hasta que se lo des.';

    // Sent straight over WhatsApp, never returned to the model - a password must not travel to
    // the AI provider or sit in the chat history.
    try {
      await ctx.wa.sendText(target.jid, portalAccessMessage(target.jid, pwd));
      const who = target.id === ctx.userId ? 'Te envié tu' : `Le envié a "${target.name}" su`;
      return `Listo. ${who} contraseña temporal en un mensaje aparte (no la repitas en tu respuesta).${note}`;
    } catch (err) {
      console.error('[TOOL] set_web_password: no se pudo enviar a %s:', target.jid, (err as Error).message);
      return `Le creé a "${target.name}" una contraseña temporal, pero no pude enviársela por WhatsApp ahora mismo. Intenta de nuevo en un momento o asígnasela desde el portal web.${note}`;
    }
  },
};
