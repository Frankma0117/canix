import type Database from 'better-sqlite3';

/** True when `table` already has `column`. Table/column names are always our own constants. */
export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/**
 * Adds a column to an existing table when it is missing - how databases created before that
 * column existed catch up (CREATE TABLE IF NOT EXISTS never alters a table that is already there).
 */
export function ensureColumn(db: Database.Database, table: string, column: string, columnDdl: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
}

/**
 * Runs a table rebuild (create new -> copy -> drop -> rename) with foreign keys off, since SQLite
 * cannot alter a CHECK or UNIQUE constraint in place and an orphaned old row must not block boot.
 */
export function withForeignKeysOff(db: Database.Database, work: () => void): void {
  const wasOn = (db.pragma('foreign_keys', { simple: true }) as number) === 1;
  if (wasOn) db.pragma('foreign_keys = OFF');
  try {
    work();
  } finally {
    if (wasOn) db.pragma('foreign_keys = ON');
  }
}
