import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

// better-sqlite3 is pinned to an EXACT version (12.11.1, no ^) in package.json on purpose - 13.x
// requires Node >= 22 (this project targets Node 20, see README's Node setup notes) and its native
// binding actually segfaults on Node 20 rather than failing cleanly. Don't `npm update`/bump this
// past 12.x without also moving the whole project's required Node version to 22+ first, and
// re-testing (a simple `new Database(':memory:')` + a query is enough to catch a bad binding before
// it reaches a real deploy).

const dbPath = resolve(process.cwd(), env.db.path);
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

/** Shared SQLite connection for the whole app. */
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Wait (up to 5s) instead of failing instantly with SQLITE_BUSY if another connection - an admin
// running scripts/audit-stickers.ts --fix, a backup - holds the write lock for a moment.
db.pragma('busy_timeout = 5000');
// Durable in WAL mode (a committed transaction survives a process crash; only an OS crash/power
// loss can lose the last few) and much faster than FULL under the web portal's request load.
db.pragma('synchronous = NORMAL');

/** Sanity check used at boot. better-sqlite3 is synchronous; this just confirms the file opened. */
export function assertDbConnection(): void {
  db.prepare('SELECT 1').get();
}
