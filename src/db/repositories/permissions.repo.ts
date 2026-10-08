import { db } from '../pool.js';
import { PERMISSIONS, DEFAULT_PACKAGES, isPermissionKey, isBillable } from '../../permissions/catalog.js';

export interface PackageRow {
  id: number;
  key: string;
  name: string;
  description: string;
  is_system: number;
  created_at: string;
  updated_at: string;
}

export interface PackageWithPermissions extends PackageRow {
  permissions: string[];
}

export interface UserOverride {
  permission_key: string;
  effect: 'allow' | 'deny';
}

export interface AuditRow {
  id: number;
  actor_user_id: number | null;
  target_user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
  actor_name?: string | null;
  target_name?: string | null;
}

/** Thrown for invalid input - message is safe to show to the admin as-is. */
export class AccessError extends Error {}

function audit(actorId: number | null, targetId: number | null, action: string, detail?: unknown): void {
  db.prepare('INSERT INTO access_audit (actor_user_id, target_user_id, action, detail) VALUES (?, ?, ?, ?)').run(
    actorId,
    targetId,
    action,
    detail === undefined ? null : JSON.stringify(detail),
  );
}

function assertKeys(keys: string[]): void {
  const bad = keys.filter((k) => !isPermissionKey(k));
  if (bad.length) throw new AccessError(`Permisos desconocidos: ${bad.join(', ')}`);
}

export const permissionsRepo = {
  /**
   * Mirrors permissions/catalog.ts into the `permissions` table and seeds the default packages the
   * first time they're seen. Idempotent and atomic - runs at every boot. A permission removed from
   * the catalog is deleted (its grants cascade away); a seeded package the admin later edited is
   * never overwritten (only created when its key doesn't exist yet).
   */
  syncCatalog(): void {
    db.transaction(() => {
      const upsert = db.prepare(
        `INSERT INTO permissions (key, module, label, description) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET module = excluded.module, label = excluded.label, description = excluded.description`,
      );
      for (const p of PERMISSIONS) upsert.run(p.key, p.module, p.label, p.description);
      const keys = PERMISSIONS.map((p) => p.key);
      db.prepare(`DELETE FROM permissions WHERE key NOT IN (${keys.map(() => '?').join(',')})`).run(...keys);

      for (const pkg of DEFAULT_PACKAGES) {
        const exists = db.prepare('SELECT 1 FROM permission_packages WHERE key = ?').get(pkg.key);
        if (exists) continue;
        const info = db
          .prepare('INSERT INTO permission_packages (key, name, description, is_system) VALUES (?, ?, ?, 1)')
          .run(pkg.key, pkg.name, pkg.description);
        const ins = db.prepare('INSERT INTO package_permissions (package_id, permission_key) VALUES (?, ?)');
        for (const perm of pkg.permissions) ins.run(Number(info.lastInsertRowid), perm);
      }
    })();
  },

  getMeta(key: string): string | undefined {
    return (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  },

  setMeta(key: string, value: string): void {
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(key, value);
  },

  listPackages(): PackageWithPermissions[] {
    const rows = db.prepare('SELECT * FROM permission_packages ORDER BY is_system DESC, name').all() as PackageRow[];
    const perms = db.prepare('SELECT package_id, permission_key FROM package_permissions').all() as {
      package_id: number;
      permission_key: string;
    }[];
    return rows.map((r) => ({ ...r, permissions: perms.filter((p) => p.package_id === r.id).map((p) => p.permission_key) }));
  },

  getPackage(idOrKey: number | string): PackageWithPermissions | undefined {
    const row = (
      typeof idOrKey === 'number'
        ? db.prepare('SELECT * FROM permission_packages WHERE id = ?').get(idOrKey)
        : db.prepare('SELECT * FROM permission_packages WHERE key = ? OR name = ? COLLATE NOCASE').get(idOrKey, idOrKey)
    ) as PackageRow | undefined;
    if (!row) return undefined;
    const perms = db.prepare('SELECT permission_key FROM package_permissions WHERE package_id = ?').all(row.id) as {
      permission_key: string;
    }[];
    return { ...row, permissions: perms.map((p) => p.permission_key) };
  },

  /** Creates or fully replaces a package's name/description/permissions, atomically. */
  savePackage(
    actorId: number,
    fields: { id?: number; key?: string; name: string; description?: string; permissions: string[] },
  ): PackageWithPermissions {
    const name = fields.name.trim();
    if (!name) throw new AccessError('El paquete necesita un nombre.');
    assertKeys(fields.permissions);
    const billable = fields.permissions.filter(isBillable);
    if (billable.length) {
      const labels = billable.map((k) => PERMISSIONS.find((p) => p.key === k)?.label ?? k).join(', ');
      throw new AccessError(`${labels}: es un extra de pago, no va en paquetes - se habilita persona por persona (permiso directo).`);
    }
    const perms = [...new Set(fields.permissions)];

    const id = db.transaction(() => {
      let pkgId = fields.id;
      if (pkgId) {
        const info = db
          .prepare(`UPDATE permission_packages SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(name, fields.description ?? '', pkgId);
        if (info.changes === 0) throw new AccessError(`No existe el paquete #${pkgId}.`);
        db.prepare('DELETE FROM package_permissions WHERE package_id = ?').run(pkgId);
      } else {
        const key = (fields.key ?? name)
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 60);
        if (!key) throw new AccessError('Nombre de paquete inválido.');
        if (db.prepare('SELECT 1 FROM permission_packages WHERE key = ?').get(key)) {
          throw new AccessError(`Ya existe un paquete con la clave "${key}".`);
        }
        pkgId = Number(
          db.prepare('INSERT INTO permission_packages (key, name, description) VALUES (?, ?, ?)').run(key, name, fields.description ?? '')
            .lastInsertRowid,
        );
      }
      const ins = db.prepare('INSERT INTO package_permissions (package_id, permission_key) VALUES (?, ?)');
      for (const p of perms) ins.run(pkgId, p);
      audit(actorId, null, fields.id ? 'package.update' : 'package.create', { package_id: pkgId, name, permissions: perms });
      return pkgId!;
    })();
    return this.getPackage(id)!;
  },

  deletePackage(actorId: number, id: number): void {
    db.transaction(() => {
      const pkg = this.getPackage(id);
      if (!pkg) throw new AccessError(`No existe el paquete #${id}.`);
      if (pkg.is_system) throw new AccessError(`"${pkg.name}" es un paquete del sistema: puedes editarlo, pero no borrarlo.`);
      db.prepare('DELETE FROM permission_packages WHERE id = ?').run(id);
      audit(actorId, null, 'package.delete', { package_id: id, name: pkg.name });
    })();
  },

  userPackages(userId: number): PackageRow[] {
    return db
      .prepare(
        `SELECT p.* FROM user_packages up JOIN permission_packages p ON p.id = up.package_id WHERE up.user_id = ? ORDER BY p.name`,
      )
      .all(userId) as PackageRow[];
  },

  userOverrides(userId: number): UserOverride[] {
    return db
      .prepare('SELECT permission_key, effect FROM user_permissions WHERE user_id = ? ORDER BY permission_key')
      .all(userId) as UserOverride[];
  },

  /** Permission keys granted through this user's packages (before overrides). */
  packagePermissionsFor(userId: number): string[] {
    return (
      db
        .prepare(
          `SELECT DISTINCT pp.permission_key FROM user_packages up
           JOIN package_permissions pp ON pp.package_id = up.package_id WHERE up.user_id = ?`,
        )
        .all(userId) as { permission_key: string }[]
    ).map((r) => r.permission_key);
  },

  hasAnyAssignment(userId: number): boolean {
    return !!(
      db.prepare('SELECT 1 FROM user_packages WHERE user_id = ? UNION SELECT 1 FROM user_permissions WHERE user_id = ? LIMIT 1').get(userId, userId)
    );
  },

  /**
   * Replaces a user's whole access configuration in one atomic step: their package list and their
   * direct allow/deny overrides. Used by the web admin page (which edits everything at once) and by
   * the chat tool. Validates every key/package first; nothing is written if anything is invalid.
   */
  setUserAccess(
    actorId: number | null,
    userId: number,
    access: { packageIds: number[]; allow: string[]; deny: string[] },
  ): void {
    assertKeys([...access.allow, ...access.deny]);
    const both = access.allow.filter((k) => access.deny.includes(k));
    if (both.length) throw new AccessError(`Un permiso no puede estar permitido y denegado a la vez: ${both.join(', ')}`);

    db.transaction(() => {
      for (const id of access.packageIds) {
        if (!db.prepare('SELECT 1 FROM permission_packages WHERE id = ?').get(id)) throw new AccessError(`No existe el paquete #${id}.`);
      }
      db.prepare('DELETE FROM user_packages WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(userId);
      const insPkg = db.prepare('INSERT INTO user_packages (user_id, package_id, granted_by) VALUES (?, ?, ?)');
      for (const id of new Set(access.packageIds)) insPkg.run(userId, id, actorId);
      const insPerm = db.prepare('INSERT INTO user_permissions (user_id, permission_key, effect, granted_by) VALUES (?, ?, ?, ?)');
      for (const k of new Set(access.allow)) insPerm.run(userId, k, 'allow', actorId);
      for (const k of new Set(access.deny)) insPerm.run(userId, k, 'deny', actorId);
      audit(actorId, userId, 'access.set', access);
    })();
  },

  addPackageToUser(actorId: number | null, userId: number, packageId: number): void {
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO user_packages (user_id, package_id, granted_by) VALUES (?, ?, ?)').run(userId, packageId, actorId);
      audit(actorId, userId, 'package.assign', { package_id: packageId });
    })();
  },

  removePackageFromUser(actorId: number | null, userId: number, packageId: number): void {
    db.transaction(() => {
      db.prepare('DELETE FROM user_packages WHERE user_id = ? AND package_id = ?').run(userId, packageId);
      audit(actorId, userId, 'package.unassign', { package_id: packageId });
    })();
  },

  /** Sets one direct override ('allow'/'deny'), or removes it with effect null. */
  setOverride(actorId: number | null, userId: number, key: string, effect: 'allow' | 'deny' | null): void {
    assertKeys([key]);
    db.transaction(() => {
      if (effect === null) db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission_key = ?').run(userId, key);
      else
        db.prepare(
          `INSERT INTO user_permissions (user_id, permission_key, effect, granted_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, permission_key) DO UPDATE SET effect = excluded.effect, granted_by = excluded.granted_by, granted_at = datetime('now')`,
        ).run(userId, key, effect, actorId);
      audit(actorId, userId, 'permission.' + (effect ?? 'clear'), { permission: key });
    })();
  },

  /**
   * Billable permissions (catalog.ts's `billable`) are never granted through a package. Moves any
   * that a package still carries (packages seeded before that rule) out: everyone who was getting
   * it through that package receives it as a direct 'allow' instead - nobody loses access silently,
   * the admin now just sees and controls it per person. Idempotent; returns how many users moved.
   */
  moveBillableOutOfPackages(): number {
    const billable = PERMISSIONS.filter((p) => p.billable).map((p) => p.key);
    if (!billable.length) return 0;
    const marks = billable.map(() => '?').join(',');
    return db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT DISTINCT up.user_id, pp.permission_key FROM package_permissions pp
           JOIN user_packages up ON up.package_id = pp.package_id WHERE pp.permission_key IN (${marks})`,
        )
        .all(...billable) as { user_id: number; permission_key: string }[];
      const ins = db.prepare(
        `INSERT OR IGNORE INTO user_permissions (user_id, permission_key, effect, granted_by) VALUES (?, ?, 'allow', NULL)`,
      );
      let moved = 0;
      for (const r of rows) {
        if (ins.run(r.user_id, r.permission_key).changes) {
          moved++;
          audit(null, r.user_id, 'permission.allow', { permission: r.permission_key, reason: 'extra de pago fuera de paquetes' });
        }
      }
      db.prepare(`DELETE FROM package_permissions WHERE permission_key IN (${marks})`).run(...billable);
      return moved;
    })();
  },

  recordAudit(actorId: number | null, targetId: number | null, action: string, detail?: unknown): void {
    audit(actorId, targetId, action, detail);
  },

  listAudit(limit = 200, targetUserId?: number): AuditRow[] {
    const where = targetUserId ? 'WHERE a.target_user_id = ?' : '';
    const params = targetUserId ? [targetUserId, limit] : [limit];
    return db
      .prepare(
        `SELECT a.*, ua.name AS actor_name, ut.name AS target_name FROM access_audit a
         LEFT JOIN users ua ON ua.id = a.actor_user_id LEFT JOIN users ut ON ut.id = a.target_user_id
         ${where} ORDER BY a.id DESC LIMIT ?`,
      )
      .all(...params) as AuditRow[];
  },
};
