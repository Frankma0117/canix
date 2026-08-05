import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { db } from './pool.js';

/**
 * Creates every table if it doesn't exist yet, and runs the small set of idempotent migrations
 * that keep older databases (single-owner, no LID, no per-routine reminder window, etc.) working
 * after an upgrade. Safe to run on every boot (see src/index.ts).
 *
 *   npm run db:init   (or it just runs automatically on `npm start`)
 */
export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      jid TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Multi-user: the admin (you) plus anyone you grant access to (see grant_access tool).
    -- Every other table below is scoped to a user_id - nothing is shared between users.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL UNIQUE,
      lid TEXT,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      title TEXT,
      description TEXT,
      used_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- LID: WhatsApp's privacy-preserving id (@lid), stored alongside the phone-number jid so
    -- messages can still be sent reliably when a contact only resolves via lid (see wa-manager.ts).
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      jid TEXT NOT NULL,
      lid TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, jid)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      scope TEXT NOT NULL DEFAULT 'today',
      due_date TEXT,
      recurrence_freq TEXT,
      -- Only used for scope = 'routine': every routine must have a reminder time and a duration
      -- ("leer a las 8, 30 minutos") - the scheduler notifies at reminder_time and asks for a
      -- check-in at reminder_time + duration_minutes (see task-scheduler.ts / create-routine.tool.ts).
      reminder_time TEXT,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Set for the pair of reminders auto-created by a routine (reminder_time / checkin prompt) -
      -- deleting the routine cascades and removes both automatically.
      todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      run_at TEXT NOT NULL,
      target_jid TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      recurrence_freq TEXT NOT NULL DEFAULT 'none',
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      kind TEXT NOT NULL DEFAULT 'reminder',
      window_start TEXT,
      window_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rewards_punishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      todo_id INTEGER REFERENCES todos(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('reward', 'punishment')),
      description TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      log_date TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(todo_id, log_date)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Structured breakdown of a routine (scope='routine' todo) into individual exercises with
    -- sets/reps/weight/duration - the routine itself still owns the habit-tracking/reminder side
    -- (see todos/habit_logs), this just attaches "what exactly to do" to it.
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sets INTEGER,
      reps INTEGER,
      seconds INTEGER,
      weight_kg REAL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- What to eat on a given date/meal slot - pure planning/reference, no reminder wired to it.
    CREATE TABLE IF NOT EXISTS meal_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_date TEXT NOT NULL,
      meal_slot TEXT NOT NULL CHECK (meal_slot IN ('desayuno', 'almuerzo', 'cena', 'onces')),
      title TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Recipes the user asked to save after a suggest-from-ingredients chat reply (see BASE_PROMPT) -
    -- suggesting one costs no extra tokens (the model just answers in text), only saving does.
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_exercises_todo ON exercises(todo_id);
    CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises(user_id);
    CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date ON meal_plans(user_id, plan_date);
    CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);

    CREATE INDEX IF NOT EXISTS idx_links_category ON links(category_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_status_run_at ON reminders(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_todos_scope_status ON todos(scope, status);
    CREATE INDEX IF NOT EXISTS idx_habit_logs_todo_date ON habit_logs(todo_id, log_date);
    CREATE INDEX IF NOT EXISTS idx_rewards_punishments_todo ON rewards_punishments(todo_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_punishments_date ON rewards_punishments(date);
  `);

  // These indexes touch user_id/todo_id, which don't exist yet on a database upgrading from the
  // single-user schema until migrateToMultiUser() below adds them - so they can only run after.
  migrateToMultiUser();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_todo ON reminders(todo_id);
    CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_punishments_user ON rewards_punishments(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
  `);

  // Columns added after the initial (single-user) release: CREATE TABLE IF NOT EXISTS won't add
  // them to an existing table, so patch them in by hand (idempotent - safe to run on every boot).
  ensureColumn('reminders', 'kind', "kind TEXT NOT NULL DEFAULT 'reminder'");
  ensureColumn('reminders', 'window_start', 'window_start TEXT');
  ensureColumn('reminders', 'window_end', 'window_end TEXT');
  // Optional link back to a saved link (see links table) so a todo/reminder can reference "haz el
  // ejercicio de tal link" without duplicating the URL - set only via chat (add_todo/schedule_reminder).
  ensureColumn('todos', 'link_id', 'link_id INTEGER REFERENCES links(id) ON DELETE SET NULL');
  ensureColumn('reminders', 'link_id', 'link_id INTEGER REFERENCES links(id) ON DELETE SET NULL');
  // JSON array of tool names this user is limited to (see set-user-permissions.tool.ts /
  // agent/ai-agent.ts). NULL (the default for every existing row) means unrestricted - nothing
  // changes for the admin or anyone already granted access until the admin explicitly restricts them.
  ensureColumn('users', 'allowed_tools', 'allowed_tools TEXT');
  // Short-cycle repeating alerts (kind 'interval') - see schedule-interval-reminder.tool.ts.
  ensureColumn('reminders', 'interval_seconds', 'interval_seconds INTEGER');
  ensureColumn('reminders', 'repeat_count', 'repeat_count INTEGER');
  ensureColumn('reminders', 'fired_count', 'fired_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn('reminders', 'with_audio', 'with_audio INTEGER NOT NULL DEFAULT 0');
  // Per-user random panel token (see server/auth.ts / users.repo.ts's ensurePanelToken). Partial
  // unique index (not a UNIQUE column constraint - SQLite's ALTER TABLE ADD COLUMN can't add one)
  // so multiple not-yet-backfilled NULLs are fine, but no two real tokens can collide.
  ensureColumn('users', 'panel_token', 'panel_token TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_panel_token ON users(panel_token) WHERE panel_token IS NOT NULL');
}

/** Adds a column to `table` if it doesn't already exist (table/column names here are always our own constants, never user input). */
function ensureColumn(table: string, column: string, columnDdl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
  }
}

function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/**
 * One-time upgrade path from the original single-owner schema to multi-user:
 * 1. Add `user_id` to every per-user table (nullable at first - SQLite can't ALTER a column to
 *    NOT NULL with a per-row value in one step).
 * 2. `categories` and `contacts` also need their UNIQUE constraint to move from a single global
 *    column to (user_id, column) - SQLite can't alter a UNIQUE constraint in place, so those two
 *    get rebuilt (rename -> recreate -> copy -> drop), same ids preserved so existing foreign
 *    keys (links.category_id, todos.category_id, etc.) stay valid.
 * 3. Migrate the old `owner` row into `users` as the admin, then backfill every NULL user_id to
 *    that admin - everything that existed before multi-user belonged to you anyway.
 * Every step is guarded so re-running this on an already-migrated (or brand new) database is a no-op.
 */
function migrateToMultiUser(): void {
  ensureColumn('todos', 'user_id', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  ensureColumn('todos', 'reminder_time', 'reminder_time TEXT');
  ensureColumn('todos', 'duration_minutes', 'duration_minutes INTEGER');
  ensureColumn('reminders', 'user_id', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  ensureColumn('reminders', 'todo_id', 'todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE');
  ensureColumn('rewards_punishments', 'user_id', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  ensureColumn('messages', 'user_id', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  ensureColumn('links', 'user_id', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');

  const needsCategoriesRebuild = !hasColumn('categories', 'user_id');
  const needsContactsRebuild = !hasColumn('contacts', 'user_id');

  if (needsCategoriesRebuild || needsContactsRebuild) {
    const fkWasOn = (db.pragma('foreign_keys', { simple: true }) as number) === 1;
    if (fkWasOn) db.pragma('foreign_keys = OFF');

    if (needsCategoriesRebuild) {
      db.exec(`
        CREATE TABLE categories_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, name)
        );
        INSERT INTO categories_new (id, name, description, created_at)
          SELECT id, name, description, created_at FROM categories;
        DROP TABLE categories;
        ALTER TABLE categories_new RENAME TO categories;
        CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
      `);
    }

    if (needsContactsRebuild) {
      db.exec(`
        CREATE TABLE contacts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          jid TEXT NOT NULL,
          lid TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, jid)
        );
        INSERT INTO contacts_new (id, name, jid, notes, created_at)
          SELECT id, name, jid, notes, created_at FROM contacts;
        DROP TABLE contacts;
        ALTER TABLE contacts_new RENAME TO contacts;
        CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
      `);
    } else {
      ensureColumn('contacts', 'lid', 'lid TEXT');
    }

    if (fkWasOn) db.pragma('foreign_keys = ON');
  } else {
    ensureColumn('contacts', 'lid', 'lid TEXT');
  }

  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    const owner = db.prepare('SELECT * FROM owner WHERE id = 1').get() as
      | { jid: string; name: string | null }
      | undefined;
    if (owner) {
      const info = db
        .prepare(`INSERT INTO users (jid, name, role) VALUES (?, ?, 'admin')`)
        .run(owner.jid, owner.name);
      const adminId = Number(info.lastInsertRowid);
      for (const table of ['categories', 'links', 'contacts', 'reminders', 'todos', 'rewards_punishments', 'messages']) {
        db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(adminId);
      }
      console.log('[DB] Migracion a multi-usuario: dueño anterior -> usuario admin #%d.', adminId);
    }
  }
}

// Allow `npm run db:init` to run this standalone too.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  initSchema();
  console.log('[DB] Esquema listo.');
}
