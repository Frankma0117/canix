import type Database from 'better-sqlite3';

/**
 * Scheduling ("agendamiento") module schema - professionals with weekly availability, clients
 * they've shared access with (directly or through a group/"agenda general"), appointments that
 * require the professional's confirmation, and their reminders. See scheduling/service.ts.
 *
 * All times are wall-clock 'YYYY-MM-DD HH:mm:ss' / 'HH:mm' strings in env.timezone, exactly like
 * every other table in this project (see util/datetime.ts) - string comparison == time order.
 *
 * Double-booking protection is layered: the service checks for overlaps inside a single
 * db.transaction() (better-sqlite3 is synchronous and this process is the only writer - see
 * util/single-instance.ts - so check-then-insert can't interleave), and the partial unique index
 * below rejects two active appointments starting at the same instant even if that check were ever
 * bypassed.
 */
export function initSchedulingSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sched_professionals (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
      specialty TEXT,
      slot_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 5 AND 480),
      buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 240),
      min_notice_minutes INTEGER NOT NULL DEFAULT 120 CHECK (min_notice_minutes BETWEEN 0 AND 20160),
      max_days_ahead INTEGER NOT NULL DEFAULT 60 CHECK (max_days_ahead BETWEEN 1 AND 365),
      -- Reminder policy for confirmed appointments (both sides get it). NULL = that one is off.
      reminder_morning_time TEXT DEFAULT '07:00' CHECK (reminder_morning_time IS NULL OR reminder_morning_time GLOB '[0-2][0-9]:[0-5][0-9]'),
      reminder_hours_before INTEGER CHECK (reminder_hours_before IS NULL OR reminder_hours_before BETWEEN 1 AND 72),
      auto_confirm INTEGER NOT NULL DEFAULT 0 CHECK (auto_confirm IN (0, 1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sched_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professional_id INTEGER NOT NULL REFERENCES sched_professionals(user_id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
      end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
      CHECK (start_time < end_time)
    );
    CREATE INDEX IF NOT EXISTS idx_sched_availability_prof ON sched_availability(professional_id, weekday);

    CREATE TABLE IF NOT EXISTS sched_time_off (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professional_id INTEGER NOT NULL REFERENCES sched_professionals(user_id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (start_at < end_at)
    );
    CREATE INDEX IF NOT EXISTS idx_sched_time_off_prof ON sched_time_off(professional_id, start_at);

    -- "Agenda general": groups several professionals (e.g. a clinic) - one combined calendar, and a
    -- client given access to a group can book with any of its members.
    CREATE TABLE IF NOT EXISTS sched_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sched_group_members (
      group_id INTEGER NOT NULL REFERENCES sched_groups(id) ON DELETE CASCADE,
      professional_id INTEGER NOT NULL REFERENCES sched_professionals(user_id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, professional_id)
    );

    -- Which professionals (or groups) a client may book with. Exactly one of the two targets.
    CREATE TABLE IF NOT EXISTS sched_client_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      professional_id INTEGER REFERENCES sched_professionals(user_id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES sched_groups(id) ON DELETE CASCADE,
      granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((professional_id IS NULL) <> (group_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sched_client_prof ON sched_client_access(client_user_id, professional_id) WHERE professional_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sched_client_group ON sched_client_access(client_user_id, group_id) WHERE group_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sched_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professional_id INTEGER NOT NULL REFERENCES sched_professionals(user_id) ON DELETE CASCADE,
      client_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show', 'expired')),
      reason TEXT,
      notes TEXT,
      cancel_reason TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status_changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (start_at < end_at)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sched_appt_active_start
      ON sched_appointments(professional_id, start_at) WHERE status IN ('pending', 'confirmed');
    CREATE INDEX IF NOT EXISTS idx_sched_appt_prof ON sched_appointments(professional_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_sched_appt_client ON sched_appointments(client_user_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_sched_appt_status ON sched_appointments(status, start_at);

    -- History of every state change of an appointment (who did what, when).
    CREATE TABLE IF NOT EXISTS sched_appointment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sched_events_appt ON sched_appointment_events(appointment_id);

    -- Reminders for confirmed appointments (one row per recipient per kind), processed by the
    -- scheduler tick (see scheduling/reminders.ts). Rebuilt whenever an appointment changes.
    CREATE TABLE IF NOT EXISTS sched_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES sched_appointments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('morning', 'before')),
      run_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
      sent_at TEXT,
      UNIQUE (appointment_id, user_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_sched_reminders_due ON sched_reminders(status, run_at);

    -- Files uploaded through the web portal (see server/uploads.ts). Stored on disk under
    -- data/uploads with a random name; this row is the only way to reach one (owner-checked).
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_name TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      sha256 TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('appointment', 'garment', 'general')),
      ref_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_uploaded_files_owner ON uploaded_files(owner_user_id, purpose);
    CREATE INDEX IF NOT EXISTS idx_uploaded_files_ref ON uploaded_files(purpose, ref_id);
  `);
}
