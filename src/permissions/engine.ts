import { permissionsRepo } from '../db/repositories/permissions.repo.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { PERMISSION_KEYS, PERMISSIONS, ADMIN_ONLY_TOOLS, toolsForPermissions, permissionForTool } from './catalog.js';
import type { User } from '../types/index.js';

/**
 * Effective permissions of a user = (union of their packages' permissions + direct 'allow')
 * minus direct 'deny'. The administrator always has everything.
 */
export function effectivePermissions(user: Pick<User, 'id' | 'role'>): Set<string> {
  if (user.role === 'admin') return new Set(PERMISSION_KEYS);
  const set = new Set(permissionsRepo.packagePermissionsFor(user.id));
  const overrides = permissionsRepo.userOverrides(user.id);
  for (const o of overrides) if (o.effect === 'allow') set.add(o.permission_key);
  for (const o of overrides) if (o.effect === 'deny') set.delete(o.permission_key);
  return set;
}

export function can(user: Pick<User, 'id' | 'role'> | undefined, permission: string): boolean {
  if (!user) return false;
  return effectivePermissions(user).has(permission);
}

/** Tool names the agent may offer/execute for this user. null = admin (everything, incl. admin tools). */
export function allowedToolsFor(user: Pick<User, 'id' | 'role'>): string[] | null {
  if (user.role === 'admin') return null;
  return toolsForPermissions(effectivePermissions(user)).filter((t) => !ADMIN_ONLY_TOOLS.includes(t));
}

/**
 * True when this person can ONLY book appointments (a professional's client) - they get a short,
 * neutral booking-assistant persona instead of the owner's personal "parcero" prompt (see
 * ai-agent.ts), since they're a stranger to the bot's owner, not a friend.
 */
export function isSchedulingClientOnly(user: Pick<User, 'id' | 'role'>): boolean {
  if (user.role === 'admin') return false;
  const perms = effectivePermissions(user);
  return perms.has('scheduling.client') && [...perms].every((p) => p === 'scheduling.client' || p === 'portal.access');
}

const MIGRATION_FLAG = 'access_migrated_v1';

/**
 * One-time upgrade from the old per-tool `users.allowed_tools` column to packages/permissions -
 * nobody gains or loses access:
 *   - NULL (unrestricted) -> the "Asistente completo" package (all personal features + portal,
 *     which is what an unrestricted user effectively had before);
 *   - a tool list -> a direct 'allow' for every permission that owns at least one of those tools.
 * Users who already have any assignment are left alone. Runs inside one transaction per user.
 */
export function migrateLegacyAccess(): void {
  if (permissionsRepo.getMeta(MIGRATION_FLAG)) return;
  const full = permissionsRepo.getPackage('completo');
  let migrated = 0;
  for (const user of usersRepo.listAll()) {
    if (user.role === 'admin' || permissionsRepo.hasAnyAssignment(user.id)) continue;
    const legacy = usersRepo.getAllowedTools(user);
    if (!legacy) {
      if (full) permissionsRepo.setUserAccess(null, user.id, { packageIds: [full.id], allow: [], deny: [] });
    } else {
      const perms = [...new Set(legacy.map(permissionForTool).filter((p): p is string => !!p))];
      permissionsRepo.setUserAccess(null, user.id, { packageIds: [], allow: perms, deny: [] });
    }
    migrated++;
  }
  permissionsRepo.setMeta(MIGRATION_FLAG, new Date().toISOString());
  if (migrated) console.log('[ACCESS] %d usuario(s) migrados del sistema de permisos anterior.', migrated);
}

/** Human summary used by chat tools and the menu: "Recordatorios, Rutinas y hábitos, ...". */
export function describePermissions(keys: Iterable<string>): string {
  const labels = [...keys].map((k) => PERMISSIONS.find((p) => p.key === k)?.label ?? k);
  return labels.length ? labels.join(', ') : '(ninguna)';
}
