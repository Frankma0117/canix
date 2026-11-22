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

    -- Automation (services/publisher/automation/): recurring rules that make, write and schedule
    -- the content by themselves. One row per rule; each time it comes due it makes a «run».
    CREATE TABLE IF NOT EXISTS publisher_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      media TEXT NOT NULL CHECK (media IN ('image', 'video')),
      format TEXT NOT NULL DEFAULT 'square',      -- images: key of studio-formats.ts · videos: 'vertical'
      layouts TEXT NOT NULL DEFAULT '[]',         -- images: layouts that take turns
      topics TEXT NOT NULL DEFAULT '[]',          -- themes that take turns (empty: the model chooses from the brand's keywords)
      platforms TEXT NOT NULL DEFAULT '[]',
      days TEXT NOT NULL DEFAULT '[]',            -- weekdays, 0 = Sunday
      time TEXT NOT NULL DEFAULT '09:00',         -- local time of the project (publisher_settings.timezone)
      lead_hours INTEGER NOT NULL DEFAULT 8,      -- how long before it goes out the piece is made
      mode TEXT NOT NULL DEFAULT 'approve' CHECK (mode IN ('approve', 'auto')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publisher_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES publisher_schedules(id) ON DELETE CASCADE,
      publish_at TEXT NOT NULL,                   -- UTC 'YYYY-MM-DD HH:MM:SS'
      item_kind TEXT NOT NULL CHECK (item_kind IN ('design', 'promo')),
      item_id INTEGER,
      post_id INTEGER,
      status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'awaiting', 'scheduled', 'published', 'partial', 'failed', 'skipped')),
      detail TEXT NOT NULL DEFAULT '',
      notified INTEGER NOT NULL DEFAULT 0,
      notice_id TEXT,                             -- WhatsApp message asking for the OK (👍 approves, 👎 skips)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (schedule_id, publish_at)
    );
    CREATE INDEX IF NOT EXISTS idx_publisher_runs_status ON publisher_runs(status, publish_at);

    -- Generated material (services/publisher/generation/): images and videos made by an image/video
    -- provider with the brand profile. Each row is also the usage/cost log (cost_cents, simulated).
    CREATE TABLE IF NOT EXISTS publisher_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media TEXT NOT NULL CHECK (media IN ('image', 'video')),
      provider TEXT NOT NULL,
      simulated INTEGER NOT NULL DEFAULT 0,       -- 1 = test provider, no real cost
      prompt TEXT NOT NULL DEFAULT '',
      aspect TEXT NOT NULL DEFAULT 'square',      -- square | portrait | landscape
      seconds INTEGER NOT NULL DEFAULT 0,         -- videos only
      title TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'ready', 'error')),
      detail TEXT NOT NULL DEFAULT '',
      file_ref TEXT NOT NULL DEFAULT '',
      poster_ref TEXT NOT NULL DEFAULT '',
      cost_cents INTEGER NOT NULL DEFAULT 0,      -- estimated cost of the call, in USD cents
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_publisher_assets_created ON publisher_assets(created_at);
  `);

  // Databases created before Meta/TikTok existed: the connection also keeps the page / account id.
  const cols = db.prepare(`PRAGMA table_info(publisher_connections)`).all() as { name: string }[];
  const runCols = db.prepare('PRAGMA table_info(publisher_runs)').all() as { name: string }[];
  if (!runCols.some((c) => c.name === 'notice_id')) db.exec('ALTER TABLE publisher_runs ADD COLUMN notice_id TEXT');
  if (!cols.some((c) => c.name === 'account_id')) db.exec(`ALTER TABLE publisher_connections ADD COLUMN account_id TEXT NOT NULL DEFAULT ''`);
}
