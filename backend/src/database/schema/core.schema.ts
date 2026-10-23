import type Database from 'better-sqlite3';

/**
 * The core schema as it is today: what a brand-new database is created with. Every table is
 * scoped to a user_id - nothing is shared between users - except the global sticker pack and the
 * WhatsApp send governor's bookkeeping. Databases created before a column existed get it from
 * migrations/core-upgrades.ts; indexes are created afterwards (createCoreIndexes) because some of
 * them cover columns that older databases only have once those upgrades ran.
 */
export function createCoreTables(db: Database.Database): void {
  db.exec(`
    -- Anti-ban send governor (see channels/whatsapp/send-guard.ts): a log of every 'proactive'
    -- (scheduler-pushed) and 'cold' (send_message to someone who never wrote in) send, so the daily
    -- caps survive a restart. Pruned to the last 7 days on every write.
    CREATE TABLE IF NOT EXISTS wa_send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK (category IN ('proactive', 'cold')),
      jid TEXT NOT NULL,
      sent_at TEXT NOT NULL
    );

    -- When each WhatsApp session was first linked - the start of the warm-up ramp that eases a new
    -- number's daily send cap up over its first two weeks.
    CREATE TABLE IF NOT EXISTS wa_session_meta (
      session TEXT PRIMARY KEY,
      first_connected_at TEXT NOT NULL
    );

    -- The admin plus everyone granted access (grant_access tool / portal).
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL UNIQUE,
      -- WhatsApp's privacy-preserving id (@lid), learned from traffic (see wa-manager.ts).
      lid TEXT,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      -- LEGACY: JSON array of tool names from before permission packages; read once by the access
      -- migration (services/permissions/permissions.service.ts), never for access checks.
      allowed_tools TEXT,
      -- Random per-user portal token (unique while set, see idx_users_panel_token).
      panel_token TEXT,
      -- Public @username handle - reference/search label only (Baileys cannot route by it yet).
      username TEXT,
      -- Every scheduled notification is silenced until this local time ('YYYY-MM-DD HH:mm:ss').
      paused_until TEXT,
      -- Section the person has open (see agent/modes.ts); NULL = none.
      active_mode TEXT,
      -- 'male'/'female'/NULL: grammatical gender the assistant uses with this person.
      gender TEXT,
      -- 'male'/'female'/NULL: which TTS voice speaks replies; voice_id = chosen natural voice.
      voice_gender TEXT,
      voice_id TEXT,
      -- Administrator test mode (services/permissions/test-mode.service.ts): JSON or NULL.
      test_mode TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Categories are shared by every module (links, notes, reminders, todos, recipes, media).
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

    -- Notes: free text to look up later (an idea, a fact, a tip) - no date, time or status.
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      title TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      jid TEXT NOT NULL,
      lid TEXT,
      notes TEXT,
      username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, jid)
    );

    -- To-dos (scope 'today'/'later') and routines (scope 'routine'). A routine has a reminder time,
    -- a duration and a schedule (see services/routines/routine-schedule.ts).
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      link_id INTEGER REFERENCES links(id) ON DELETE SET NULL,
      scope TEXT NOT NULL DEFAULT 'today',
      due_date TEXT,
      recurrence_freq TEXT,
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      -- "1,3,5" (0 = Sunday), the day of the month for monthly ones, and the date the pattern is
      -- anchored to (decides which week/month is "on" when the interval is > 1).
      weekdays TEXT,
      month_day INTEGER,
      start_date TEXT,
      reminder_time TEXT,
      duration_minutes INTEGER,
      -- Set on a routine that belongs to Ejercicios (boxeo, zumba, gym...) - see services/workouts/.
      workout_kind TEXT,
      place TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Medicines, vitamins, creams, skincare, water and body care (girdle...) on a schedule; each time becomes a reminder
    -- (kind 'medication', medication_id) - see services/medications/.
    CREATE TABLE IF NOT EXISTS medications (
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

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Set on the reminders a routine owns - deleting the routine removes them.
      todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
      link_id INTEGER REFERENCES links(id) ON DELETE SET NULL,
      -- Owned by a medication (kind 'medication') or a planned meal (kinds 'meal'/'meal_prep').
      medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE,
      meal_plan_id INTEGER REFERENCES meal_plans(id) ON DELETE CASCADE,
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
      -- Short-cycle repeating alerts (kind 'interval').
      interval_seconds INTEGER,
      repeat_count INTEGER,
      fired_count INTEGER NOT NULL DEFAULT 0,
      with_audio INTEGER NOT NULL DEFAULT 0,
      paused_until TEXT,
      -- Recurring notices that go unanswered auto-suspend (see jobs/task-scheduler.ts).
      awaiting_confirmation INTEGER NOT NULL DEFAULT 0,
      missed_confirmations INTEGER NOT NULL DEFAULT 0,
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

    -- Conversation history sent to the model as context (cleared daily).
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A routine broken down into exercises (sets/reps/weight/duration).
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

    -- What to eat on a given date and meal slot.
    CREATE TABLE IF NOT EXISTS meal_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_date TEXT NOT NULL,
      meal_slot TEXT NOT NULL CHECK (meal_slot IN ('desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena')),
      title TEXT NOT NULL,
      notes TEXT,
      -- 'HH:mm' - with a time, a reminder announces the meal; prep_minutes also announces "toca
      -- preparar" that many minutes before.
      meal_time TEXT,
      prep_minutes INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Lists ticked off item by item (shopping, games...); kind = what it is a list of (see
    -- shared/utils/list-kinds.ts). Lists of music, movies, series, books, games and podcasts are the
    -- media library (services/library/): their items carry who made it, genre, year, a summary,
    -- the link it came from, a rating and the person's own notes; checked = watched/read/listened.
    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      creator TEXT,
      genre TEXT,
      year INTEGER,
      summary TEXT,
      url TEXT,
      link_id INTEGER REFERENCES links(id) ON DELETE SET NULL,
      rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
      notes TEXT,
      done_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Fashion Mode: one garment registered from a photo. The taxonomy (type/category/style...)
    -- lives in code (services/fashion/taxonomy.ts), so adding a category needs no migration.
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
      neckline TEXT,
      sleeves TEXT,
      length TEXT,
      closure TEXT,
      pockets TEXT,
      -- Generated only from the structured fields (services/fashion/description.ts).
      short_description TEXT,
      long_description TEXT,
      -- Per-field confidence and which model/pipeline version produced the fields.
      analysis_confidence TEXT,
      analysis_model TEXT,
      analysis_version INTEGER,
      analyzed_at TEXT,
      -- Photo fingerprint (spots the same picture saved twice) and last color reading.
      image_hash TEXT,
      color_checked_at TEXT,
      llm_attempts INTEGER NOT NULL DEFAULT 0,
      -- Last day it was worn: worn this week = left out of suggestions until Monday.
      worn_on TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      ai_metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- WhatsApp messages Fashion Mode sent that can be reacted to: a garment photo of an outfit,
    -- the outfit summary, or a "delete this garment?" question. payload is the outfit as shown
    -- (JSON), so a reaction still works after the chat moved on. Pruned after 30 days.
    CREATE TABLE IF NOT EXISTS fashion_message_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      msg_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('outfit', 'garment', 'delete_confirm')),
      garment_id INTEGER REFERENCES garments(id) ON DELETE CASCADE,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Questions the vision LLM left about a garment, answered in the portal.
    CREATE TABLE IF NOT EXISTS garment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      garment_id INTEGER NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      suggested TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'skipped')),
      answer TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      answered_at TEXT
    );

    -- Fashion Mode's conversational state machine, one row per user.
    CREATE TABLE IF NOT EXISTS fashion_sessions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'FASHION_IDLE',
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Styling profile, one per user. height/build/size are stored for reference only - never
    -- applied as a body-type rule.
    CREATE TABLE IF NOT EXISTS fashion_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      height_cm INTEGER,
      build TEXT,
      size TEXT,
      preferred_colors TEXT, -- JSON array
      avoided_colors TEXT,   -- JSON array
      preferred_styles TEXT, -- JSON array
      reference_photo_key TEXT,
      reference_photo_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A saved outfit; outfit_garments.role is the garment's type (TOP/BOTTOM/...).
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

    -- The bot's sticker pack: only the admin adds stickers (sent as a real WhatsApp sticker and
    -- named by their next text, or uploaded in the portal). Global: any conversation can receive
    -- one. moments = JSON array of moment keys it fits (services/stickers/sticker-moments.ts), NULL
    -- until the admin sets them (then they are suggested from the name); usage = the admin's own
    -- note on when to use it, shown to the agent; sent_count/last_sent_at drive the rotation.
    CREATE TABLE IF NOT EXISTS stickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      data BLOB NOT NULL,
      mimetype TEXT NOT NULL DEFAULT 'image/webp',
      moments TEXT,
      usage TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sent_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Phone-call reminders (Twilio). status is this row's lifecycle (pending -> processing ->
    -- completed/failed/cancelled); twilio_call_status is Twilio's own progress, updated by the
    -- status webhook. 'completed' is only ever set from Twilio's callback. call_type 'reminder'
    -- speaks the message; 'alarm' only rings.
    CREATE TABLE IF NOT EXISTS call_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      message TEXT NOT NULL,
      call_type TEXT NOT NULL DEFAULT 'reminder' CHECK (call_type IN ('reminder', 'alarm')),
      scheduled_at TEXT NOT NULL,
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

    -- Usage of paid operations (AI tokens, natural voice characters, calls) per user.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per reminder/routine occurrence that asked "¿lo hiciste?" (current answer);
    -- reminder_responses keeps every answer in order, with its time and where it came from.
    -- poll_msg_id/poll_secret belong to the old poll-based confirmation and are no longer written.
    CREATE TABLE IF NOT EXISTS reminder_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reminder_id INTEGER REFERENCES reminders(id) ON DELETE SET NULL,
      todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
      medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      occurrence_date TEXT NOT NULL,
      sent_at TEXT,
      text_msg_id TEXT,
      poll_msg_id TEXT,
      poll_secret BLOB,
      answer TEXT CHECK (answer IN ('yes', 'no')),
      answered_at TEXT,
      answer_source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminder_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER NOT NULL REFERENCES reminder_prompts(id) ON DELETE CASCADE,
      answer TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
      source TEXT NOT NULL CHECK (source IN ('poll', 'reply', 'chat', 'web')),
      created_at TEXT NOT NULL
    );

    -- A closed question the bot asked (see agent/choices.ts), tied to the message carrying it:
    -- what each quick answer (a 👍/👎 reaction, or the option's number) counts as. Only the latest
    -- one per person stays 'open', except 'sticky' ones, whose answers are complete commands.
    CREATE TABLE IF NOT EXISTS choice_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      msg_id TEXT NOT NULL,
      options TEXT NOT NULL,
      is_binary INTEGER NOT NULL DEFAULT 0,
      is_sticky INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_at TEXT NOT NULL
    );
  `);
}

/** Every core index - run after the upgrades, since some cover columns older databases gain there. */
export function createCoreIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wa_send_log_category_sent_at ON wa_send_log(category, sent_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_panel_token ON users(panel_token) WHERE panel_token IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
    CREATE INDEX IF NOT EXISTS idx_links_category ON links(category_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_scope_status ON todos(scope, status);
    CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_todo ON reminders(todo_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_status_run_at ON reminders(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_rewards_punishments_user ON rewards_punishments(user_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_punishments_todo ON rewards_punishments(todo_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_punishments_date ON rewards_punishments(date);
    CREATE INDEX IF NOT EXISTS idx_habit_logs_todo_date ON habit_logs(todo_id, log_date);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_exercises_todo ON exercises(todo_id);
    CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises(user_id);
    CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date ON meal_plans(user_id, plan_date);
    CREATE INDEX IF NOT EXISTS idx_medications_user ON medications(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_medication ON reminders(medication_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_meal_plan ON reminders(meal_plan_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_prompts_medication ON reminder_prompts(medication_id, occurrence_date);
    CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
    CREATE INDEX IF NOT EXISTS idx_checklists_user ON checklists(user_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items(checklist_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_items_user ON checklist_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_items_link ON checklist_items(link_id);
    CREATE INDEX IF NOT EXISTS idx_garments_user ON garments(user_id);
    CREATE INDEX IF NOT EXISTS idx_garments_user_type ON garments(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_garments_user_favorite ON garments(user_id, favorite);
    CREATE INDEX IF NOT EXISTS idx_garment_questions_user ON garment_questions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_garment_questions_garment ON garment_questions(garment_id);
    CREATE INDEX IF NOT EXISTS idx_fashion_message_refs_msg ON fashion_message_refs(user_id, msg_id);
    CREATE INDEX IF NOT EXISTS idx_outfits_user ON outfits(user_id);
    CREATE INDEX IF NOT EXISTS idx_outfit_garments_outfit ON outfit_garments(outfit_id);
    CREATE INDEX IF NOT EXISTS idx_outfit_garments_garment ON outfit_garments(garment_id);
    CREATE INDEX IF NOT EXISTS idx_stickers_label ON stickers(label);
    CREATE INDEX IF NOT EXISTS idx_call_reminders_status_scheduled ON call_reminders(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_call_reminders_user ON call_reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_call_reminders_call_sid ON call_reminders(twilio_call_sid);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_prompts_user ON reminder_prompts(user_id, occurrence_date);
    CREATE INDEX IF NOT EXISTS idx_reminder_prompts_todo ON reminder_prompts(todo_id, occurrence_date);
    CREATE INDEX IF NOT EXISTS idx_reminder_prompts_poll ON reminder_prompts(poll_msg_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_responses_prompt ON reminder_responses(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_choice_prompts_msg ON choice_prompts(msg_id);
    CREATE INDEX IF NOT EXISTS idx_choice_prompts_user ON choice_prompts(user_id, status);
  `);
}
