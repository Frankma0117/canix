import type Database from 'better-sqlite3';

/**
 * Videos made with the Remotion "taller" (services/video-studio/): each row keeps the JSON spec
 * (callouts, mascot, scenes) the admin edits, the render status and, once approved, the file in
 * Spaces. Idempotent, runs at every boot.
 */
export function initVideoStudioSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_specs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      spec TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'rendering', 'review', 'approved', 'error')),
      detail TEXT NOT NULL DEFAULT '',
      file TEXT,                               -- review: name inside the taller's out dir · approved: Spaces key / local ref
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
