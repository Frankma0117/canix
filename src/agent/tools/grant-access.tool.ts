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
    'comparte. NUNCA elijas el paquete por tu cuenta: si el administrador no dijo cuál, llama sin "package" y la ' +
    'herramienta te devuelve las opciones para preguntarle. "ninguno" = acceso sin funciones (se habilitan después). ' +
    'Pide siempre el número CON indicativo de país (ej. 57 para Colombia) si no es obvio de dónde es.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Número de WhatsApp con indicativo de país (ej. 573001234567).' },
      name: { type: 'string', description: 'Nombre de la persona.' },
      package: {
        type: 'string',
        description: 'Paquete que el ADMINISTRADOR dijo explícitamente (clave o nombre), o "ninguno". Omítelo si no lo dijo: no adivines.',
      },
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

    // No default package on purpose: access is granted only to what the admin explicitly chose
    // (a silent "completo" default handed everything - and listed it - to someone who should get
    // little or nothing).
    const pkgRef = String(args.package ?? '').trim();
    const options = permissionsRepo
      .listPackages()
      .filter((p) => p.key !== 'demo')
      .map((p) => `"${p.name}" (${p.permissions.length} funciones)`)
      .join(', ');
    if (!pkgRef) {
      return (
        `Antes de darle acceso a ${name}, pregúntale al administrador qué paquete le asigna: ${options}, o "ninguno" ` +
        '(acceso sin funciones, para habilitárselas una por una después). No lo elijas tú. Los extras de pago se dan aparte.'
      );
    }
    const none = /^(ninguno|ninguna|none|sin permisos|nada)$/i.test(pkgRef);
    const pkg = none ? null : permissionsRepo.getPackage(pkgRef);
    if (!none && !pkg) return `No existe el paquete "${pkgRef}". Opciones: ${options}, o "ninguno".`;
    const pkgLabel = pkg ? `paquete "${pkg.name}"` : 'sin funciones todavía';

    const jid = phoneToJid(phone);
    const existed = !!usersRepo.getByJidOrLid(jid);
    const user = usersRepo.create({ jid, name, role: 'user', username });
    if (pkg) permissionsRepo.addPackageToUser(ctx.userId, user.id, pkg.id);
    else permissionsRepo.recordAudit(ctx.userId, user.id, 'access.granted_without_permissions');
    ensureWeeklyReportReminder(user.id, user.jid);
    ensureDailyResetReminder(user.id, user.jid);
    ensureDailyDedupReminder(user.id, user.jid);

    const perms = effectivePermissions(user);
    const accessSummary = describePermissions(perms);
    if (existed) {
      return pkg
        ? `"${user.name}" ya tenía acceso; le sumé el paquete "${pkg.name}". Ahora puede usar: ${accessSummary}.`
        : `"${user.name}" ya tenía acceso; no cambié sus permisos (puede usar: ${accessSummary}).`;
    }

    // Best-effort right away: confirm the number is real, and cache its lid so the bot can reach
    // them from the get-go.
    const [exists] = await Promise.all([ctx.wa.checkOnWhatsApp(jid), ctx.wa.prefetchLid(jid)]);
    if (exists === false) {
      return (
        `Le di acceso a "${user.name}" (#${user.id}, ${pkgLabel}), pero ese número no parece tener WhatsApp. ` +
        'Revisa que esté completo con el indicativo del país (ej. 57 para Colombia, sin el +).'
      );
    }

    // This is often the very first message the bot sends this jid (a cold contact) - report the
    // real delivery outcome instead of always claiming success (see wa-manager.ts's ensurePrivacyToken).
    try {
      // Only what this person can actually use - and nothing listed at all when that's nothing yet.
      const offer = perms.size
        ? `Te puedo ayudar con: ${accessSummary}. Escribe /menu cuando quieras ver todo el detalle.`
        : 'El administrador te irá habilitando las funciones; te aviso cuando estén listas.';
      await ctx.wa.sendText(
        jid,
        `¡Hola ${user.name}! Soy Canix, tu asistente virtual 🤖 Ya tienes acceso. ${offer}\n\n` +
          '👤 Una última cosa: ¿eres hombre o mujer? Así te hablo en el género correcto y uso la voz que ' +
          'corresponde en las notas de voz (respóndeme solo "hombre" o "mujer").',
      );
      if (can(user, 'portal.access')) {
        const pwd = await issueTemporaryPassword(user.id, ctx.userId);
        await ctx.wa.sendText(jid, portalAccessMessage(jid, pwd));
      }
    } catch (err) {
      console.error('[TOOL] grant_access: no se pudo avisar a %s:', jid, (err as Error).message);
      return (
        `Le di acceso a "${user.name}" (#${user.id}, ${pkgLabel}), pero no pude escribirle por WhatsApp ahora ` +
        'mismo (puede pasar si nunca te ha escrito). Pídele que le escriba al bot; luego usa set_web_password si necesita el portal.'
      );
    }

    return pkg
      ? `Listo, "${user.name}" ya tiene acceso (#${user.id}) con el paquete "${pkg.name}": ${accessSummary}. Le escribí para avisarle.`
      : `Listo, "${user.name}" ya tiene acceso (#${user.id}) sin funciones todavía; habilítaselas en el portal (Personas) o pídemelas. Le escribí para avisarle.`;
  },
};
