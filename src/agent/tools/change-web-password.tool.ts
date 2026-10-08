import type { Tool } from '../tool-registry.js';
import { issueTemporaryPassword } from '../../auth/web-auth.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { portalAccessMessage, healPhone } from './set-web-password.tool.js';

export const changeWebPasswordTool: Tool = {
  name: 'change_web_password',
  description:
    'Genera una contraseña temporal NUEVA para que yo entre al portal web (si la olvidé o es la primera vez). El ' +
    'portal me pedirá cambiarla al entrar. Cierra mis otras sesiones abiertas.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    const found = usersRepo.getById(ctx.userId);
    if (!found) return 'No encontré tu cuenta.';
    const me = await healPhone(found, (lid) => ctx.wa.resolveLidToPhoneJid(lid));
    const pwd = await issueTemporaryPassword(me.id, me.id);
    // Sent directly, never returned to the model (see set-web-password.tool.ts).
    await ctx.wa.sendText(ctx.ownerJid, portalAccessMessage(me.jid, pwd));
    return 'Listo, te envié la contraseña temporal en un mensaje aparte (no la repitas en tu respuesta).';
  },
};
