import type Database from 'better-sqlite3';

/**
 * Access-control schema: permissions catalog, packages, per-user assignments, audit trail, and web
 * portal credentials/sessions. Called from initSchema() (db/init.ts) after the base tables exist.
 *
 * Integrity is enforced by the database itself, not just by the code that writes it:
 *   - every relationship is a FOREIGN KEY (foreign_keys = ON, see pool.ts) with ON DELETE CASCADE,
 *     so removing a user/package can never leave orphaned grants behind;
 *   - CHECK constraints pin enumerations (allow/deny) and invariants;
 *   - composite PRIMARY KEYs make a duplicate grant impossible;
 *   - multi-row changes always go through db.transaction() in the repositories (atomic: a grant
 *     plus its audit row commit together or not at all).
 */
export function initAccessSchema(db: Database.Database): void {
  db.exec(`
    -- Small key/value store for one-time migrations and similar flags.
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Mirror of permissions/catalog.ts (synced at boot) - exists so grants can be FK-checked.
    CREATE TABLE IF NOT EXISTS permissions (
      key TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS permission_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 60),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS package_permissions (
      package_id INTEGER NOT NULL REFERENCES permission_packages(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      PRIMARY KEY (package_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS user_packages (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id INTEGER NOT NULL REFERENCES permission_packages(id) ON DELETE CASCADE,
      granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, package_id)
    );

    -- Direct per-user overrides on top of packages. 'deny' always wins over any package.
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
      granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, permission_key)
    );

    -- Append-only trail of every access change (who, to whom, what) - written in the SAME
    -- transaction as the change itself.
    CREATE TABLE IF NOT EXISTS access_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_access_audit_target ON access_audit(target_user_id, created_at);

    -- Web portal sessions. Only a SHA-256 hash of the token is stored - a leaked database
    -- doesn't hand out live sessions.
    CREATE TABLE IF NOT EXISTS web_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
  `);

  // Web credentials live on users (one account per WhatsApp number, number = login).
  ensureColumn(db, 'users', 'password_hash', 'password_hash TEXT');
  ensureColumn(db, 'users', 'must_change_password', 'must_change_password INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'password_updated_at', 'password_updated_at TEXT');
  ensureColumn(db, 'users', 'failed_logins', 'failed_logins INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'locked_until', 'locked_until TEXT');
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
