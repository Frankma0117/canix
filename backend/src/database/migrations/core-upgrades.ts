import type Database from 'better-sqlite3';
import { ensureColumn, withForeignKeysOff } from '../schema-helpers.js';
import { inferListKind } from '../../shared/utils/list-kinds.js';
import { CATEGORIES_BY_TYPE } from '../../services/fashion/taxonomy.js';

/**
 * Brings a database created by an older release up to the current core schema
 * (schema/core.schema.ts). Every step is idempotent - it checks before it changes anything - so it
 * runs on every boot and is a no-op on an up-to-date or brand-new database.
 */
export function upgradeCoreSchema(db: Database.Database): void {
  addMissingColumns(db);
  rebuildMealPlansForNewSlots(db);
  rebuildMedicationsForWater(db);
  backfillData(db);
  dropRetiredTables(db);
}

/** Columns added after a table's first release, in the order they were introduced. */
function addMissingColumns(db: Database.Database): void {
  const columns: [table: string, column: string, ddl: string][] = [
    ['contacts', 'lid', 'lid TEXT'],
    ['contacts', 'username', 'username TEXT'],
    ['reminders', 'kind', "kind TEXT NOT NULL DEFAULT 'reminder'"],
    ['reminders', 'window_start', 'window_start TEXT'],
    ['reminders', 'window_end', 'window_end TEXT'],
    ['reminders', 'link_id', 'link_id INTEGER REFERENCES links(id) ON DELETE SET NULL'],
    ['reminders', 'interval_seconds', 'interval_seconds INTEGER'],
    ['reminders', 'repeat_count', 'repeat_count INTEGER'],
    ['reminders', 'fired_count', 'fired_count INTEGER NOT NULL DEFAULT 0'],
    ['reminders', 'with_audio', 'with_audio INTEGER NOT NULL DEFAULT 0'],
    ['reminders', 'paused_until', 'paused_until TEXT'],
    ['reminders', 'awaiting_confirmation', 'awaiting_confirmation INTEGER NOT NULL DEFAULT 0'],
    ['reminders', 'missed_confirmations', 'missed_confirmations INTEGER NOT NULL DEFAULT 0'],
    ['todos', 'link_id', 'link_id INTEGER REFERENCES links(id) ON DELETE SET NULL'],
    ['todos', 'weekdays', 'weekdays TEXT'],
    ['todos', 'recurrence_interval', 'recurrence_interval INTEGER NOT NULL DEFAULT 1'],
    ['todos', 'month_day', 'month_day INTEGER'],
    ['todos', 'start_date', 'start_date TEXT'],
    ['todos', 'workout_kind', 'workout_kind TEXT'],
    ['todos', 'place', 'place TEXT'],
    ['todos', 'notes', 'notes TEXT'],
    ['users', 'allowed_tools', 'allowed_tools TEXT'],
    ['users', 'panel_token', 'panel_token TEXT'],
    ['users', 'username', 'username TEXT'],
    ['users', 'paused_until', 'paused_until TEXT'],
    ['users', 'active_mode', 'active_mode TEXT'],
    ['users', 'gender', 'gender TEXT'],
    ['users', 'voice_gender', 'voice_gender TEXT'],
    ['users', 'voice_id', 'voice_id TEXT'],
    ['users', 'test_mode', 'test_mode TEXT'],
    ['call_reminders', 'recurrence_freq', "recurrence_freq TEXT NOT NULL DEFAULT 'none'"],
    ['call_reminders', 'recurrence_interval', 'recurrence_interval INTEGER NOT NULL DEFAULT 1'],
    ['garments', 'neckline', 'neckline TEXT'],
    ['garments', 'sleeves', 'sleeves TEXT'],
    ['garments', 'length', 'length TEXT'],
    ['garments', 'closure', 'closure TEXT'],
    ['garments', 'pockets', 'pockets TEXT'],
    ['garments', 'short_description', 'short_description TEXT'],
    ['garments', 'long_description', 'long_description TEXT'],
    ['garments', 'analysis_confidence', 'analysis_confidence TEXT'],
    ['garments', 'analysis_model', 'analysis_model TEXT'],
    ['garments', 'analysis_version', 'analysis_version INTEGER'],
    ['garments', 'analyzed_at', 'analyzed_at TEXT'],
    ['garments', 'image_hash', 'image_hash TEXT'],
    ['garments', 'color_checked_at', 'color_checked_at TEXT'],
    ['garments', 'llm_attempts', 'llm_attempts INTEGER NOT NULL DEFAULT 0'],
    ['garments', 'worn_on', 'worn_on TEXT'],
    ['checklists', 'kind', 'kind TEXT'],
    ['checklist_items', 'creator', 'creator TEXT'],
    ['checklist_items', 'genre', 'genre TEXT'],
    ['checklist_items', 'year', 'year INTEGER'],
    ['checklist_items', 'summary', 'summary TEXT'],
    ['checklist_items', 'url', 'url TEXT'],
    ['checklist_items', 'link_id', 'link_id INTEGER REFERENCES links(id) ON DELETE SET NULL'],
    ['checklist_items', 'rating', 'rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)'],
    ['checklist_items', 'notes', 'notes TEXT'],
    ['checklist_items', 'done_at', 'done_at TEXT'],
    ['reminders', 'medication_id', 'medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE'],
    ['reminders', 'meal_plan_id', 'meal_plan_id INTEGER REFERENCES meal_plans(id) ON DELETE CASCADE'],
    ['reminder_prompts', 'medication_id', 'medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE'],
    ['meal_plans', 'meal_time', 'meal_time TEXT'],
    ['meal_plans', 'prep_minutes', 'prep_minutes INTEGER'],
    ['stickers', 'moments', 'moments TEXT'],
    ['stickers', 'usage', 'usage TEXT'],
    ['stickers', 'active', 'active INTEGER NOT NULL DEFAULT 1'],
    ['stickers', 'sent_count', 'sent_count INTEGER NOT NULL DEFAULT 0'],
    ['stickers', 'last_sent_at', 'last_sent_at TEXT'],
  ];
  for (const [table, column, ddl] of columns) ensureColumn(db, table, column, ddl);
}

/** medications' kind CHECK didn't allow 'water' / 'bodycare' at first: rebuild once (same columns, same ids). */
function rebuildMedicationsForWater(db: Database.Database): void {
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'medications'").get() as { sql: string } | undefined)?.sql ?? '';
  if (!sql || sql.includes("'bodycare'")) return;
  withForeignKeysOff(db, () =>
    db.exec(`
      CREATE TABLE medications_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'medicine' CHECK (kind IN ('medicine', 'vitamin', 'supplement', 'cream', 'skincare', 'water', 'bodycare', 'other')),
        dose TEXT,
        instructions TEXT,
        times TEXT NOT NULL DEFAULT '[]',
        weekdays TEXT,
        start_date TEXT,
        end_date TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO medications_new SELECT id, user_id, name, kind, dose, instructions, times, weekdays, start_date, end_date, notes, active, created_at, updated_at FROM medications;
      DROP TABLE medications;
      ALTER TABLE medications_new RENAME TO medications;
      CREATE INDEX IF NOT EXISTS idx_medications_user ON medications(user_id);
    `),
  );
}

/** meal_plans' CHECK used to allow fewer slots; SQLite cannot alter a CHECK in place: rebuild once. */
function rebuildMealPlansForNewSlots(db: Database.Database): void {
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'meal_plans'").get() as { sql: string } | undefined)?.sql ?? '';
  if (!sql || sql.includes('media_tarde')) return;
  withForeignKeysOff(db, () =>
    db.exec(`
      CREATE TABLE meal_plans_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_date TEXT NOT NULL,
        meal_slot TEXT NOT NULL CHECK (meal_slot IN ('desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena')),
        title TEXT NOT NULL,
        notes TEXT,
        meal_time TEXT,
        prep_minutes INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO meal_plans_new (id, user_id, plan_date, meal_slot, title, notes, created_at)
        SELECT id, user_id, plan_date, meal_slot, title, notes, created_at FROM meal_plans;
      DROP TABLE meal_plans;
      ALTER TABLE meal_plans_new RENAME TO meal_plans;
    `),
  );
}

function backfillData(db: Database.Database): void {
  // Weekly routines created before `weekdays` existed: their day is the weekday their reminder
  // currently falls on.
  db.exec(`
    UPDATE todos SET weekdays = (
      SELECT CAST(strftime('%w', r.run_at) AS TEXT) FROM reminders r
      WHERE r.todo_id = todos.id AND r.kind = 'routine_reminder' LIMIT 1
    )
    WHERE scope = 'routine' AND recurrence_freq = 'weekly' AND weekdays IS NULL
  `);

  // A garment's type follows from its category: trousers saved as a "top" (classifier got the type
  // wrong, the category right) could never be picked as the bottom of an outfit.
  for (const [type, categories] of Object.entries(CATEGORIES_BY_TYPE)) {
    const marks = categories.map(() => '?').join(',');
    db.prepare(`UPDATE garments SET type = ? WHERE type != ? AND category IN (${marks})`).run(type, type, ...categories.map((c) => c.value));
  }

  // Lists created before `kind` existed are classified once from their name.
  for (const row of db.prepare('SELECT id, name FROM checklists WHERE kind IS NULL').all() as { id: number; name: string }[]) {
    db.prepare('UPDATE checklists SET kind = ? WHERE id = ?').run(inferListKind(row.name), row.id);
  }

  // The automatic daily-agenda push (kind 'daily_agenda') was retired: cancel any left pending.
  db.prepare(`UPDATE reminders SET status = 'cancelled' WHERE kind = 'daily_agenda' AND status = 'pending'`).run();
}

/** Tables of retired features: the single-owner schema, shared-contact drafts, option polls. */
function dropRetiredTables(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS owner;
    DROP TABLE IF EXISTS pending_shared_contacts;
    DROP TABLE IF EXISTS choice_polls;
  `);
}
