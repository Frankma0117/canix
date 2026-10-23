import { usersModel } from '../../models/users.model.js';
import { messagesModel } from '../../models/messages.model.js';
import { permissionsModel, AccessError } from '../../models/permissions.model.js';
import { nowLocal } from '../../shared/utils/datetime.js';
import { PERMISSIONS, isPermissionKey } from './catalog.js';
import { describePermissions, testModeOf, type TestMode } from './permissions.service.js';
import type { User } from '../../entities/index.js';

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
  usersModel.setActiveMode(adminId, null);
  messagesModel.clear(adminId);
}

export function enterTestMode(admin: User, choice: { label: string; permissions: string[] }): TestMode {
  if (admin.role !== 'admin') throw new AccessError('Solo el administrador puede usar el modo prueba.');
  const permissions = [...new Set(choice.permissions)].filter(isPermissionKey);
  if (permissions.length === 0) throw new AccessError('Elige al menos una función para probar.');
  const testMode: TestMode = { label: choice.label.trim().slice(0, 80) || 'Personalizado', permissions, since: nowLocal() };
  usersModel.setTestMode(admin.id, JSON.stringify(testMode));
  switchContext(admin.id);
  permissionsModel.recordAudit(admin.id, admin.id, 'testmode.on', { label: testMode.label, permissions });
  console.log('[TEST] Administrator #%d entered test mode (%s).', admin.id, testMode.label);
  return testMode;
}

/** Returns false if the mode wasn't on. */
export function exitTestMode(admin: User): boolean {
  if (!testModeOf(admin)) return false;
  usersModel.setTestMode(admin.id, null);
  switchContext(admin.id);
  permissionsModel.recordAudit(admin.id, admin.id, 'testmode.off');
  console.log('[TEST] Administrator #%d left test mode.', admin.id);
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
  const packages = permissionsModel.listPackages().filter((p) => p.permissions.length > 0);
  const exact = packages.filter((p) => norm(p.key) === q || norm(p.name) === q);
  if (exact.length) return exact;
  const byName = packages.filter((p) => norm(p.name).includes(q) || norm(p.key).includes(q));
  if (byName.length) return byName;
  return packages.filter((p) => p.permissions.some((k) => norm(PERMISSIONS.find((d) => d.key === k)?.module ?? '').startsWith(q)));
}

const VERB_IN = '(?:entra|entrar|entrame|activa|activar|activame|pon|ponme|poner|inicia|iniciar|empieza|empezar|abre|abrir|quiero)';
const VERB_OUT = '(?:sal|salte|salir|salgamos|salgo|sacame|termina|terminar|quita|quitar|quitame|apaga|apagar|desactiva|desactivar|cierra|cerrar|finaliza|finalizar|deja|dejar)';
// "/prueba agenda", "modo prueba agenda", "entra en modo prueba de agenda", "activa el modo prueba"
const ENTER_RE = new RegExp(`^(?:\\/pruebas?|(?:${VERB_IN}\\s+)?(?:en\\s+|el\\s+|al\\s+|a\\s+)?modo\\s+(?:de\\s+)?pruebas?)(?:\\s+(?:de\\s+|del\\s+|con\\s+|para\\s+)?(?:el\\s+|la\\s+)?(?:paquete\\s+)?(.+))?$`, 'i');
// "/prueba salir", "sal del modo prueba", "quita el modo prueba", "ya no quiero modo prueba", "modo normal"
const EXIT_RE = new RegExp(
  `^(?:\\/pruebas?\\s+(?:salir|off|fin|terminar|apagar)|\\/?(?:ya\\s+)?${VERB_OUT}\\s+(?:de\\s+|del\\s+|el\\s+|la\\s+)?(?:modo\\s+)?(?:de\\s+)?pruebas?|ya no quiero (?:el\\s+)?modo (?:de\\s+)?pruebas?|modo pruebas? (?:off|salir|fin|no)|(?:vuelve|volver|regresa|regresar)\\s+a(?:l)?\\s+(?:modo\\s+)?(?:normal|completo|administrador|admin)|modo (?:normal|administrador|admin))$`,
  'i',
);

function packageList(): string {
  return permissionsModel
    .listPackages()
    .filter((p) => p.permissions.length > 0)
    .map((p) => `- *${p.name}*: ${describePermissions(p.permissions)}`)
    .join('\n');
}

/** Line added to the menu while the mode is on, so it's never forgotten. */
export function testModeNotice(testMode: TestMode): string {
  return `🧪 *Modo prueba activo* · ${testMode.label}\n> Para volver a tu acceso completo escribe "sal del modo prueba"`;
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
  // Said however it comes out: no accents, no closing punctuation, "por favor" or not.
  const trimmed = norm(text).replace(/[¿?¡!.,]/g, ' ').replace(/\b(por favor|porfa|canix)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const current = testModeOf(admin);

  if (EXIT_RE.test(trimmed)) {
    if (!exitTestMode(admin)) return '🧪 *Modo prueba*\nNo está activo: tienes tu acceso completo de administrador.\n\n> Para probar un paquete escribe "modo prueba" y su nombre';
    return '✅ *Saliste del modo prueba*\nYa tienes de nuevo todas tus funciones y el control de administrador.';
  }

  const match = ENTER_RE.exec(trimmed);
  if (!match) return null;

  const query = match[1]?.trim();
  if (!query) {
    const status = current
      ? `🧪 *Modo prueba activo* · ${current.label}\nAhora mismo solo tienes: ${describePermissions(current.permissions)}.\n\n> Para volver a tu acceso completo escribe "sal del modo prueba"`
      : '🧪 *Modo prueba*\nUsas a Canix como lo vería alguien con un paquete, sin perder tu acceso. El portal web sigue completo.';
    return `${status}\n\n📦 *Paquetes que puedes probar*\n${packageList()}\n\n> Escribe "modo prueba" y el nombre del paquete`;
  }

  const matches = findPackages(query);
  if (matches.length === 0) {
    return `🧪 *Modo prueba*\nNo encontré un paquete llamado "${query}".\n\n📦 *Los que hay*\n${packageList()}\n\n> También puedes armar una combinación a tu medida en el portal: Administración → Modo prueba`;
  }
  if (matches.length > 1) {
    return `🧪 *Modo prueba*\nVarios paquetes coinciden con "${query}". ¿Cuál quieres probar?\n\n${matches.map((p) => `- *${p.name}*`).join('\n')}\n\n> Escribe "modo prueba" y el nombre completo`;
  }
  const pkg = matches[0];
  const testMode = enterTestMode(admin, { label: pkg.name, permissions: pkg.permissions });
  return (
    `🧪 *Modo prueba activado* · ${testMode.label}\n` +
    `Desde ya me comporto contigo como con alguien que solo tiene: ${describePermissions(testMode.permissions)}.\n\n` +
    '> Tu portal web sigue con acceso total\n> Para volver a tener todo escribe "sal del modo prueba"'
  );
}
