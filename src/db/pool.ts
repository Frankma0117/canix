import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

const dbPath = resolve(process.cwd(), env.db.path);
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

/** Shared SQLite connection for the whole app. */
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Sanity check used at boot. better-sqlite3 is synchronous; this just confirms the file opened. */
export function assertDbConnection(): void {
  db.prepare('SELECT 1').get();
}
