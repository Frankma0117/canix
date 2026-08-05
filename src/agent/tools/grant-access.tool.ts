import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { phoneToJid } from '../../util/jid.js';
import { ensureDailyAgendaReminder } from '../agenda.js';
import { env } from '../../config/env.js';

export const grantAccessTool: Tool = {
  name: 'grant_access',
  description:
    'Le da acceso al bot a otra persona (solo el administrador puede usar esto). Cada persona tiene su propia ' +
    'configuración, recordatorios, rutinas, contactos, etc. — completamente separados, nada se comparte entre usuarios. ' +
    'Pide siempre el número CON indicativo de país (ej. 57 para Colombia) si no es obvio de dónde es.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Número de WhatsApp con indicativo de país (ej. 573001234567).' },
      name: { type: 'string', description: 'Nombre de la persona.' },
    },
    required: ['phone', 'name'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede dar acceso a otras personas.';
    const phone = String(args.phone ?? '').trim();
    const name = String(args.name ?? '').trim();
    if (!phone || !name) return 'Error: falta el número o el nombre.';

    const jid = phoneToJid(phone);
    const user = usersRepo.create({ jid, name, role: 'user' });
    ensureDailyAgendaReminder(user.id, user.jid);
    const panelToken = usersRepo.ensurePanelToken(user.id);

    // Best-effort right away: confirm the number is real, and cache its lid so the bot can reach
    // them (and you can message them, if saved as a contact too) from the get-go.
    const [exists] = await Promise.all([ctx.wa.checkOnWhatsApp(jid), ctx.wa.prefetchLid(jid)]);

    if (exists === false) {
      return (
        `Le di acceso a "${user.name}" (#${user.id}), pero ese número no parece tener WhatsApp. ` +
        'Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).'
      );
    }

    // Their own panel token - separate from yours, only ever shows their own data (see server/auth.ts).
    const panelLine = env.panelUrl ? `${env.panelUrl} con este token: ${panelToken}` : `este token: ${panelToken}`;
    await ctx.wa
      .sendText(jid, `¡Hola ${user.name}! Ya tienes acceso a este asistente. Si quieres, también puedes entrar al panel web en ${panelLine}`)
      .catch((err) => console.error('[TOOL] grant_access: no se pudo avisar el token del panel a %s:', jid, (err as Error).message));

    return `Listo, "${user.name}" ya tiene acceso al bot con su propia configuración (#${user.id}) y le avisé su token del panel.`;
  },
};
