import type Database from 'better-sqlite3';

/**
 * Videos made with the Remotion "taller" (services/video-studio/): each row keeps the JSON spec
 * (callouts, mascot, scenes) the admin edits, the render status and, once approved, the file in
 * Spaces. Idempotent, runs at every boot.
 */
const COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'previewing', 'rendering', 'review', 'approved', 'error')),
  detail TEXT NOT NULL DEFAULT '',
  file TEXT,                               -- approved: Spaces key / local ref
  preview_file TEXT,                       -- review: low-res silent mp4 kept in the taller's out dir until approved/discarded
  group_id TEXT,                           -- the 3 videos made by one "recuadros" request share it
  kind TEXT NOT NULL DEFAULT '',           -- reel | instagram | tutorial | '' (single video)
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`;

export function initVideoStudioSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS video_specs (${COLUMNS});`);
  // Older table: its CHECK lacks 'previewing' and it has no preview/group columns. SQLite cannot alter a CHECK,
  // so rebuild once (a render waiting in 'review' under the old flow goes back to draft: the file is dropped).
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'video_specs'").get() as { sql: string }).sql;
  if (sql.includes("'previewing'")) return;
  db.transaction(() => {
    db.exec('ALTER TABLE video_specs RENAME TO video_specs_old');
    db.exec(`CREATE TABLE video_specs (${COLUMNS})`);
    db.exec(`INSERT INTO video_specs (id, title, spec, status, detail, file, created_by, created_at, updated_at)
      SELECT id, title, spec, CASE WHEN status = 'review' THEN 'draft' ELSE status END, detail, CASE WHEN status = 'review' THEN NULL ELSE file END, created_by, created_at, updated_at FROM video_specs_old`);
    db.exec('DROP TABLE video_specs_old');
  })();
}
