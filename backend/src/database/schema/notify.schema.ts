import type Database from 'better-sqlite3';

/**
 * Canix as the messenger of the administrator's other projects (see services/notify/): each
 * project gets an API key, sends messages to the administrator's WhatsApp, and can ask for an
 * approval that is answered with 👍 / 👎 or a link and comes back to the project as a signed
 * webhook. Idempotent, runs at every boot.
 */
export function initNotifySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notify_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL UNIQUE,              -- sha256 of the API key: the key itself is shown once and never kept
      key_prefix TEXT NOT NULL,                   -- first characters, to recognize it in the list
      webhook_url TEXT NOT NULL DEFAULT '',
      webhook_secret_enc TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notify_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES notify_clients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('message', 'approval')),
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      ref TEXT NOT NULL DEFAULT '',               -- the project's own reference, returned in the webhook
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'pending', 'approved', 'rejected', 'expired')),
      token TEXT UNIQUE,                          -- the confirmation link (approvals)
      wa_message_id TEXT,
      decided_via TEXT,                           -- reaction | link
      decided_at TEXT,
      expires_at TEXT,
      webhook_state TEXT NOT NULL DEFAULT 'none' CHECK (webhook_state IN ('none', 'pending', 'sent', 'failed')),
      webhook_attempts INTEGER NOT NULL DEFAULT 0,
      webhook_next_at TEXT,
      webhook_error TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notify_messages_wa ON notify_messages(wa_message_id);
    CREATE INDEX IF NOT EXISTS idx_notify_messages_open ON notify_messages(status, expires_at);
  `);
}
