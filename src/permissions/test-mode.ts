import { usersRepo } from '../db/repositories/users.repo.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { permissionsRepo, AccessError } from '../db/repositories/permissions.repo.js';
import { nowLocal } from '../util/datetime.js';
import { PERMISSIONS, isPermissionKey } from './catalog.js';
import { describePermissions, testModeOf, type TestMode } from './engine.js';
import type { User } from '../types/index.js';

/**
 * "Modo prueba": the administrator tries the bot on WhatsApp exactly as someone with a given
 * package (or hand-picked permissions) would get it - only those tools, that menu, no admin
 * commands - without touching their real access. The web portal keeps showing everything, and
 * leaving the mode (from the portal, or "/prueba salir" on WhatsApp) restores it all at once,
 * because nothing was ever removed: the bot just looks at the test set while the mode is on.
 */
function switchContext(adminId: number): void {
  // Same hard context boundary as entering/leaving a special mode (see agent/modes.ts): the
  // conversation so far was held with a different set of abilities.
  usersRepo.setActiveMode(adminId, null);
  messagesRepo.clear(adminId);
}

export function enterTestMode(admin: User, choice: { label: string; permissions: string[] }): TestMode {
  if (admin.role !== 'admin') throw new AccessError('Solo el administrador puede usar el modo prueba.');
  const permissions = [...new Set(choice.permissions)].filter(isPermissionKey);
  if (permissions.length === 0) throw new AccessError('Elige al menos una función para probar.');
  const testMode: TestMode = { label: choice.label.trim().slice(0, 80) || 'Personalizado', permissions, since: nowLocal() };
  usersRepo.setTestMode(admin.id, JSON.stringify(testMode));
  switchContext(admin.id);
  permissionsRepo.recordAudit(admin.id, admin.id, 'testmode.on', { label: testMode.label, permissions });
  console.log('[TEST] Administrador #%d entró a modo prueba (%s).', admin.id, testMode.label);
  return testMode;
}

/** Returns false if the mode wasn't on. */
export function exitTestMode(admin: User): boolean {
  if (!testModeOf(admin)) return false;
  usersRepo.setTestMode(admin.id, null);
  switchContext(admin.id);
  permissionsRepo.recordAudit(admin.id, admin.id, 'testmode.off');
  console.log('[TEST] Administrador #%d salió del modo prueba.', admin.id);
  return true;
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * The packages the admin may mean on WhatsApp ("profesional", "Solo recordatorios", "agenda"): an
 * exact name/key wins; otherwise every package whose name contains the text, or failing that,
 * every one that includes a function of that module. More than one = ask, never guess.
 */
function findPackages(query: string) {
  const q = norm(query);
  const packages = permissionsRepo.listPackages().filter((p) => p.permissions.length > 0);
  const exact = packages.filter((p) => norm(p.key) === q || norm(p.name) === q);
  if (exact.length) return exact;
  const byName = packages.filter((p) => norm(p.name).includes(q) || norm(p.key).includes(q));
  if (byName.length) return byName;
  return packages.filter((p) => p.permissions.some((k) => norm(PERMISSIONS.find((d) => d.key === k)?.module ?? '').startsWith(q)));
}

const ENTER_RE = /^(?:\/pruebas?|modo pruebas?)(?:\s+(.+))?$/i;
const EXIT_RE =
  /^(?:\/pruebas?\s+(?:salir|off|fin|terminar|apagar)|\/?(?:salir|terminar|quitar|apagar)\s+(?:de\s+|del\s+)?(?:modo\s+)?pruebas?)$/i;

function packageList(): string {
  return permissionsRepo
    .listPackages()
    .filter((p) => p.permissions.length > 0)
    .map((p) => `• *${p.name}* — ${describePermissions(p.permissions)}`)
    .join('\n');
}

/** Line added to the menu while the mode is on, so it's never forgotten. */
export function testModeNotice(testMode: TestMode): string {
  return `🧪 *Modo prueba activo:* ${testMode.label}. Escribe */prueba salir* para volver a tu acceso completo.`;
}

/**
 * The administrator's WhatsApp commands for the mode - handled as raw commands (no AI turn), so
 * leaving always works no matter how restricted the set being tried is:
 *   /prueba                 estado y paquetes disponibles
 *   /prueba <paquete>       entrar probando ese paquete
 *   /prueba salir           volver al acceso completo
 * Returns the reply to send, or null when the text isn't one of these commands.
 */
export function handleTestModeCommand(admin: User, text: string): string | null {
  if (admin.role !== 'admin') return null;
  const trimmed = text.trim();
  const current = testModeOf(admin);

  if (EXIT_RE.test(trimmed)) {
    if (!exitTestMode(admin)) return 'No estás en modo prueba: tienes tu acceso completo de administrador. 👍';
    return '✅ Saliste del *modo prueba*. Ya tienes de nuevo todas tus funciones y el control de administrador.';
  }

  const match = ENTER_RE.exec(trimmed);
  if (!match) return null;

  const query = match[1]?.trim();
  if (!query) {
    const status = current
      ? `🧪 Estás en *modo prueba*: ${current.label} (${describePermissions(current.permissions)}).\nEscribe */prueba salir* para volver a tu acceso completo.`
      : '🧪 *Modo prueba*: usa el asistente como lo vería alguien con un paquete, sin perder tu acceso (el portal web sigue completo).';
    return `${status}\n\nPara probar uno escribe */prueba <nombre>*:\n${packageList()}`;
  }

  const matches = findPackages(query);
  if (matches.length === 0) {
    return `No encontré un paquete llamado "${query}". Estos son los que hay:\n${packageList()}\n\nTambién puedes armar una combinación a tu medida desde el portal web (Administración → Modo prueba).`;
  }
  if (matches.length > 1) {
    return `Hay varios paquetes que coinciden con "${query}". ¿Cuál quieres probar?\n${matches.map((p) => `• */prueba ${p.name}*`).join('\n')}`;
  }
  const pkg = matches[0];
  const testMode = enterTestMode(admin, { label: pkg.name, permissions: pkg.permissions });
  return (
    `🧪 *Modo prueba activado:* ${testMode.label}\n` +
    `Ahora me comporto contigo como con alguien que solo tiene: ${describePermissions(testMode.permissions)}.\n\n` +
    'Tu portal web sigue con acceso total. Cuando termines escribe */prueba salir* (o sal desde el portal) y vuelves a tener todo.'
  );
}
