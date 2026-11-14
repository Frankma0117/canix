import type Database from 'better-sqlite3';

/**
 * Content publisher (see services/publisher/): schedules videos and images on the project's own
 * social accounts. Self-contained on purpose - the module is copied to other projects, so the only
 * outside reference is the optional promo_item_id (the generated material). Idempotent, runs at every boot.
 */
export function initPublisherSchema(db: Database.Database): void {
  db.exec(`
    -- One row (id = 1): how this project talks on social media. Feeds the SEO suggestions.
    CREATE TABLE IF NOT EXISTS publisher_brand (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'es',
      audience TEXT NOT NULL DEFAULT '',
      cta TEXT NOT NULL DEFAULT '',
      hashtags TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One connection per platform. Tokens are stored encrypted (publisher-crypto.ts), never in clear.
    CREATE TABLE IF NOT EXISTS publisher_connections (
      platform TEXT PRIMARY KEY CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
      provider TEXT NOT NULL DEFAULT 'mock',
      account_name TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      access_token_enc TEXT,
      refresh_token_enc TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
      last_error TEXT NOT NULL DEFAULT '',
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publisher_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_item_id INTEGER,
      media_type TEXT NOT NULL CHECK (media_type IN ('video', 'image')),
      media_ref TEXT NOT NULL DEFAULT '',
      thumbnail_ref TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      hashtags TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      seo TEXT NOT NULL DEFAULT '{}',             -- per platform: {title, description, hashtags}
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed')),
      scheduled_at TEXT,                          -- UTC 'YYYY-MM-DD HH:MM:SS'
      published_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_publisher_posts_due ON publisher_posts(status, scheduled_at);

    -- One row per (post, platform): each one succeeds, fails and retries on its own.
    CREATE TABLE IF NOT EXISTS publisher_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES publisher_posts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
      external_id TEXT,
      external_url TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      UNIQUE (post_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_publisher_targets_post ON publisher_targets(post_id);

    CREATE TABLE IF NOT EXISTS publisher_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL REFERENCES publisher_targets(id) ON DELETE CASCADE,
      ok INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publisher_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Visual identity (one row, id = 1): colors, type, style and the approved logo. Feeds the brand studio.
    CREATE TABLE IF NOT EXISTS publisher_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      colors TEXT NOT NULL DEFAULT '{}',          -- {primary, secondary, accent, dark, light}
      style TEXT NOT NULL DEFAULT '',             -- visual direction used for generated art
      font TEXT NOT NULL DEFAULT 'modern',        -- modern | elegant | friendly | bold
      logo_ref TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Brand studio (services/publisher/studio/): logos, covers, profile pictures and posts, drawn
    -- with the identity. Each one waits for the administrator's review.
    CREATE TABLE IF NOT EXISTS publisher_designs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('logo', 'cover', 'profile', 'post', 'story')),
      layout TEXT NOT NULL DEFAULT '',            -- hero | split | tip | quote | mark | banner
      format TEXT NOT NULL,                       -- key of studio-formats.ts
      brief TEXT NOT NULL DEFAULT '',
      use_ai INTEGER NOT NULL DEFAULT 0,          -- 1 = an image model painted the art (costs money)
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'working', 'review', 'approved', 'rejected', 'error')),
      detail TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',           -- text to post with it
      content TEXT NOT NULL DEFAULT '{}',         -- {headline, sub, bullets, cta, art_prompt}
      file_ref TEXT NOT NULL DEFAULT '',
      art_ref TEXT NOT NULL DEFAULT '',           -- the AI art alone, reused when only the texts change
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_publisher_designs_status ON publisher_designs(status, created_at);
  `);

  // Databases created before Meta/TikTok existed: the connection also keeps the page / account id.
  const cols = db.prepare(`PRAGMA table_info(publisher_connections)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'account_id')) db.exec(`ALTER TABLE publisher_connections ADD COLUMN account_id TEXT NOT NULL DEFAULT ''`);
}
