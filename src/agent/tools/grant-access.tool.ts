import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { permissionsRepo } from '../../db/repositories/permissions.repo.js';
import { phoneToJid } from '../../util/jid.js';
import { ensureWeeklyReportReminder } from '../weekly-report.js';
import { ensureDailyResetReminder } from '../daily-reset.js';
import { ensureDailyDedupReminder } from '../dedup.js';
import { can, effectivePermissions, describePermissions } from '../../permissions/engine.js';
import { issueTemporaryPassword } from '../../auth/web-auth.js';
import { portalAccessMessage } from './set-web-password.tool.js';

export const grantAccessTool: Tool = {
  name: 'grant_access',
  description:
    'Le da acceso al bot a otra persona (solo el administrador). Cada persona tiene su propia configuración, nada se ' +
    'comparte. Se le asigna un paquete de permisos (default "completo"; ver list_permissions). Pide siempre el ' +
    'número CON indicativo de país (ej. 57 para Colombia) si no es obvio de dónde es.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Número de WhatsApp con indicativo de país (ej. 573001234567).' },
      name: { type: 'string', description: 'Nombre de la persona.' },
      package: { type: 'string', description: 'Paquete de permisos a asignar (clave o nombre). Default: completo.' },
      username: { type: 'string', description: 'Su @username público de WhatsApp, si lo saben (opcional, solo etiqueta de referencia).' },
    },
    required: ['phone', 'name'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede dar acceso a otras personas.';
    const phone = String(args.phone ?? '').trim();
    const name = String(args.name ?? '').trim();
    if (!phone || !name) return 'Me falta el número o el nombre.';
    const username = args.username ? String(args.username).trim() : null;

    const pkgRef = String(args.package ?? 'completo').trim();
    const pkg = permissionsRepo.getPackage(pkgRef);
    if (!pkg) return `No existe el paquete "${pkgRef}" - mira list_permissions.`;

    const jid = phoneToJid(phone);
    const existed = !!usersRepo.getByJidOrLid(jid);
    const user = usersRepo.create({ jid, name, role: 'user', username });
    permissionsRepo.addPackageToUser(ctx.userId, user.id, pkg.id);
    ensureWeeklyReportReminder(user.id, user.jid);
    ensureDailyResetReminder(user.id, user.jid);
    ensureDailyDedupReminder(user.id, user.jid);

    const accessSummary = describePermissions(effectivePermissions(user));
    if (existed) return `"${user.name}" ya tenía acceso; le sumé el paquete "${pkg.name}". Ahora puede usar: ${accessSummary}.`;

    // Best-effort right away: confirm the number is real, and cache its lid so the bot can reach
    // them from the get-go.
    const [exists] = await Promise.all([ctx.wa.checkOnWhatsApp(jid), ctx.wa.prefetchLid(jid)]);
    if (exists === false) {
      return (
        `Le di acceso a "${user.name}" (#${user.id}, paquete "${pkg.name}"), pero ese número no parece tener WhatsApp. ` +
        'Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).'
      );
    }

    // This is often the very first message the bot sends this jid (a cold contact) - report the
    // real delivery outcome instead of always claiming success (see wa-manager.ts's ensurePrivacyToken).
    try {
      await ctx.wa.sendText(
        jid,
        `¡Hola ${user.name}! Soy Canix, tu asistente virtual 🤖 Ya tienes acceso. Te puedo ayudar con: ${accessSummary}. ` +
          'Escribe /menu cuando quieras ver todo el detalle.\n\n' +
          '👤 Una última cosa: ¿eres hombre o mujer? Así te hablo en el género correcto y uso la voz que ' +
          'corresponde en las notas de voz (respóndeme solo "hombre" o "mujer").',
      );
      if (can(user, 'portal.access')) {
        const pwd = await issueTemporaryPassword(user.id, ctx.userId);
        await ctx.wa.sendText(jid, portalAccessMessage(jid.split('@')[0], pwd));
      }
    } catch (err) {
      console.error('[TOOL] grant_access: no se pudo avisar a %s:', jid, (err as Error).message);
      return (
        `Le di acceso a "${user.name}" (#${user.id}, paquete "${pkg.name}"), pero no pude escribirle por WhatsApp ahora ` +
        'mismo (puede pasar si nunca te ha escrito). Pídele que le escriba al bot; luego usa set_web_password si necesita el portal.'
      );
    }

    return `Listo, "${user.name}" ya tiene acceso (#${user.id}) con el paquete "${pkg.name}": ${accessSummary}. Le escribí para avisarle.`;
  },
};
