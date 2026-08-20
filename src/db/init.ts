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

    -- Notas importantes: texto libre para consultar después (una idea, un dato, algo que le
    -- dijeron) - a diferencia de todos/reminders, no tienen fecha, hora ni estado. Reusa la misma
    -- tabla de categorías que ya usan links/todos, no una propia.
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      title TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    -- Fashion Mode (armario/outfits, ver src/fashion/): una prenda registrada por foto. La
    -- taxonomia (type/category/style/etc.) vive en código (src/fashion/taxonomy.ts), no aquí
    -- adrede - así agregar una categoría nueva es un cambio de un array, no una migración.
    CREATE TABLE IF NOT EXISTS garments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_id TEXT NOT NULL UNIQUE,
      storage_key TEXT NOT NULL,
      image_url TEXT NOT NULL,
      thumbnail_key TEXT,
      thumbnail_url TEXT,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT,
      gender TEXT,
      color TEXT,
      secondary_colors TEXT,
      pattern TEXT,
      material TEXT,
      fit TEXT,
      style TEXT,
      formality TEXT,
      season TEXT,
      weather TEXT,
      occasions TEXT,
      brand TEXT,
      size TEXT,
      condition TEXT,
      warmth TEXT,
      water_resistance TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      ai_metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Fashion Mode's own conversational state machine - one row per user (1:1), kept fully
    -- separate from the users table so this module never needs to touch the core auth table.
    CREATE TABLE IF NOT EXISTS fashion_sessions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'FASHION_IDLE',
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A saved outfit (a combination of garments) - only persisted when the user explicitly saves
    -- one (see outfit.flow.ts). "role" on outfit_garments matches src/fashion/taxonomy.ts's
    -- GarmentType (TOP/BOTTOM/FULL_BODY/OUTERWEAR/FOOTWEAR/ACCESSORY) - reused directly instead of
    -- inventing a parallel enum, since a garment's role in an outfit is exactly its own type.
    CREATE TABLE IF NOT EXISTS outfits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      occasion TEXT,
      formality TEXT,
      season TEXT,
      style TEXT,
      notes TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      ai_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outfit_garments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
      garment_id INTEGER NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      UNIQUE(outfit_id, garment_id)
    );

    -- The bot's sticker pack (see agent/modes.ts's ALWAYS_ON_TOOLS, agent/tools/send-sticker.tool.ts).
    -- Only the admin can teach the bot a new one, by sending it as a real WhatsApp sticker (see
    -- bot-manager.ts) - it's saved here with label = NULL until their next plain-text message names
    -- it. Global (no user_id scope): every user's conversation can receive one, only uploading is
    -- admin-only. The AI agent picks WHEN to send one on its own, from the labels listed in its
    -- system prompt context - never asked to by the person chatting.
    CREATE TABLE IF NOT EXISTS stickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      data BLOB NOT NULL,
      mimetype TEXT NOT NULL DEFAULT 'image/webp',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stickers_label ON stickers(label);

    -- Contact card(s) someone just shared via WhatsApp's native "share contact" feature (see
    -- util/vcard.ts, bot-manager.ts), waiting on their explicit "sí"/"no"/"1,3" reply before any of
    -- them actually becomes a real row in the contacts table - see agent/tools/add-contact.tool.ts
    -- for the table they graduate into. Sharing a new batch before answering replaces whatever was
    -- pending (see pending-contacts.repo.ts's replaceForUser) - acting on a stale, already-
    -- superseded offer would be confusing.
    CREATE TABLE IF NOT EXISTS pending_shared_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pending_shared_contacts_user ON pending_shared_contacts(user_id);

    -- Phone-call reminders (Twilio Programmable Voice, see src/calls/) - a separate resource from
    -- the WhatsApp-text reminders table above (different channel, different fields, different
    -- status vocabulary), processed by the SAME scheduler tick (see scheduler/task-scheduler.ts)
    -- instead of a second worker. status is this row's own lifecycle (pending -> processing ->
    -- completed/failed/cancelled) - twilio_call_status separately tracks Twilio's own call
    -- progress (queued/ringing/in-progress/completed/busy/no-answer/failed/canceled), updated by
    -- the status callback webhook (see server/twilio-webhook.ts). Reaching 'processing' is NOT the
    -- same as the call being answered - see call-reminders.service.ts's comment on why 'completed'
    -- is only ever set from Twilio's own callback, never just because the API accepted the request.
    -- call_type distinguishes the two ways this can ring someone (see calls/call-reminders.service.ts's
    -- buildTwiml): 'reminder' speaks the message then hangs up (a genuinely important reminder the
    -- user explicitly asked to get as a PHONE CALL, not a routine WhatsApp one); 'alarm' says
    -- nothing at all and hangs up the instant it's answered - the ringing itself IS the alarm, like
    -- a wake-up call. This whole feature is deliberately NOT wired to general reminders - see
    -- agent/tools/schedule-call-reminder.tool.ts's description for why the AI only offers it for
    -- something truly important or an explicit alarm request.
    CREATE TABLE IF NOT EXISTS call_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      message TEXT NOT NULL,
      call_type TEXT NOT NULL DEFAULT 'reminder' CHECK (call_type IN ('reminder', 'alarm')),
      scheduled_at TEXT NOT NULL,
      -- Same convention as reminders.recurrence_freq/interval (see nextCallScheduledAt in
      -- calls/call-reminders.service.ts) - 'daily' + interval=2 is "every 2 days". A recurring one
      -- only advances to its next occurrence once Twilio reports the call actually completed (see
      -- handleCallStatusUpdate) - never just because it was dispatched.
      recurrence_freq TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_freq IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
      twilio_call_sid TEXT,
      twilio_call_status TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_call_reminders_status_scheduled ON call_reminders(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_call_reminders_user ON call_reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_call_reminders_call_sid ON call_reminders(twilio_call_sid);

    -- Token/cost visibility for Fashion Mode's AI calls (intent classification + outfit
    -- recommendation) - separate from the general [LLM] console log in ai-agent.ts, so "cuánto
    -- está gastando Fashion Mode" can be answered on its own instead of mixed with normal chat use.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_garments_user ON garments(user_id);
    CREATE INDEX IF NOT EXISTS idx_garments_user_type ON garments(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_garments_user_favorite ON garments(user_id, favorite);
    CREATE INDEX IF NOT EXISTS idx_outfits_user ON outfits(user_id);
    CREATE INDEX IF NOT EXISTS idx_outfit_garments_outfit ON outfit_garments(outfit_id);
    CREATE INDEX IF NOT EXISTS idx_outfit_garments_garment ON outfit_garments(garment_id);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);

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
  // WhatsApp's public @username handle (the new username-based identity WhatsApp is rolling out
  // alongside phone numbers) - stored purely as a label on a saved contact for your own reference/
  // search (see add-contact.tool.ts). NOT used to route messages: the installed Baileys version's
  // username->jid USync resolution isn't wired up yet (see contacts.repo.ts's getByUsername), so
  // sending still always needs a real phone number under the hood.
  ensureColumn('contacts', 'username', 'username TEXT');
  // Same @username label as contacts.username, but for a person who has bot access themselves (see
  // grant-access.tool.ts) - reference/search only, same limitation (no username->jid resolution).
  ensureColumn('users', 'username', 'username TEXT');
  // Pausing notifications: NULL = not paused. On `users`, pauses EVERYTHING for that person (see
  // pause-notifications.tool.ts). On `reminders`, pauses just that one row - a paused routine sets
  // this on both its linked routine_reminder/routine_checkin rows together (see routine-setup.ts's
  // pauseRoutine). Recurring reminders silently fast-forward past a pause (no backlog on resume);
  // one-off reminders just sit pending and fire on the first tick once the pause lifts (see
  // task-scheduler.ts). Both 'YYYY-MM-DD HH:mm:ss' local wall time, same format as run_at.
  ensureColumn('users', 'paused_until', 'paused_until TEXT');
  ensureColumn('reminders', 'paused_until', 'paused_until TEXT');
  // Special modes (see agent/modes.ts) - which category, if any, this user is currently "inside"
  // (rutinas/tareas/notas/contactos/comidas/premios/resumenes). NULL = default mode (recordatorios).
  ensureColumn('users', 'active_mode', 'active_mode TEXT');
  // Recurring call reminders (e.g. "llámame cada 2 días a las 8am") - added after call_reminders'
  // initial release, see the table's own comment above.
  ensureColumn('call_reminders', 'recurrence_freq', "recurrence_freq TEXT NOT NULL DEFAULT 'none'");
  ensureColumn('call_reminders', 'recurrence_interval', 'recurrence_interval INTEGER NOT NULL DEFAULT 1');
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
