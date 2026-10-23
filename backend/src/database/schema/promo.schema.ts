import type Database from 'better-sqlite3';

/**
 * Advertising material made from the admin portal (see services/promo/): videos (narrated, in
 * horizontal and vertical) and still images (square, story and horizontal), both drawn from the
 * brand - WhatsApp chats, the mascot's stickers, the real features. Each one waits for the
 * administrator's review. Idempotent, runs at every boot.
 */
export function initPromoSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media TEXT NOT NULL CHECK (media IN ('video', 'image')),
      kind TEXT NOT NULL,                      -- ad | howto | feature
      feature TEXT,                            -- key of services/promo/promo-catalog.ts FEATURES
      layout TEXT,                             -- images: chat | features | mascot
      formats TEXT NOT NULL DEFAULT '[]',      -- videos: landscape, vertical · images: square, story, landscape
      idea TEXT NOT NULL DEFAULT '',           -- optional direction from the administrator
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'working', 'review', 'approved', 'rejected', 'error')),
      detail TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',        -- text to post with it
      content TEXT NOT NULL DEFAULT '{}',      -- video: {scenes} · image: {headline, sub, bullets, cta, chat}
      files TEXT NOT NULL DEFAULT '{}',        -- {"vertical": {"file", "poster", "seconds"}} · {"square": {"file"}}
      voice TEXT,                              -- key of services/audio/voices.ts VOICES (videos)
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_promo_items_status ON promo_items(status, created_at);

    CREATE TABLE IF NOT EXISTS promo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
