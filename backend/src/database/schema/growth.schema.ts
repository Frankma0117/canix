import type Database from 'better-sqlite3';
import { ensureColumn } from '../schema-helpers.js';

/**
 * Tables for the public side of the product (see services/growth/): free demo requests coming from the
 * landing page, and first-party web analytics (no third-party trackers, no IPs stored - visitors
 * are a salted daily hash, see analytics.service.ts). Idempotent, runs at every boot.
 */
export function initGrowthSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      interest TEXT,
      visitor TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'activated', 'discarded')),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      activated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status, created_at);

    CREATE TABLE IF NOT EXISTS web_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      path TEXT,
      label TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      device TEXT,
      visitor TEXT,
      session TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_events_ts ON web_events(ts);
    CREATE INDEX IF NOT EXISTS idx_web_events_type_ts ON web_events(type, ts);
  `);

  ensureColumn(db, 'users', 'demo_expires_at', 'demo_expires_at TEXT');
  ensureColumn(db, 'users', 'demo_status', 'demo_status TEXT');
}
