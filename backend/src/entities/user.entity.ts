
export type UserRole = 'admin' | 'user';

/**
 * A person allowed to use the bot. The admin (you) plus anyone granted access (see grant_access
 * tool). Every other entity below belongs to exactly one user - nothing is shared between users.
 */
export interface User {
  id: number;
  jid: string;
  // WhatsApp's privacy-preserving id (@lid), learned automatically from traffic once known (see
  // wa-manager.ts). Kept alongside jid so messages/identity checks still work when WhatsApp
  // routes via lid instead of the phone-number jid.
  lid: string | null;
  name: string | null;
  role: UserRole;
  // LEGACY (pre-packages): JSON array of tool names. Only read once, by the one-time migration to
  // packages/permissions (see services/permissions/permissions.service.ts's migrateLegacyAccess) - never for access checks.
  allowed_tools: string | null;
  // Random per-user token for the web panel (see api/middleware/auth.middleware.ts) - each granted user gets their
  // own, scoped to only their own data, instead of everyone sharing one admin-only token.
  panel_token: string | null;
  // WhatsApp's public @username handle, if known - reference/search label only, same limitation as
  // Contact.username (see contacts.model.ts's getByUsername).
  username: string | null;
  // Set = every scheduled notification for this person is silenced until this moment (see
  // pause-notifications.tool.ts / task-scheduler.ts). NULL = not paused.
  paused_until: string | null;
  // Which special mode (see agent/modes.ts) this user is currently inside - restricts which tools
  // the AI agent can call this turn to just that category (plus reminders/links, always on). NULL
  // = default mode (recordatorios), the only one active without an explicit entry command.
  active_mode: string | null;
  // 'male'/'female'/NULL (not yet known) - see set-user-gender.tool.ts and database/migrate.ts's migration
  // comment for why this exists as its own stored field instead of re-inferred from the name/context
  // on every turn.
  gender: 'male' | 'female' | null;
  // 'male'/'female'/NULL (not set, falls back to the default Piper voice) - which TTS voice reads
  // voice-note replies back to this person. See set-voice-gender.tool.ts / services/audio/tts.ts. Separate
  // from `gender` above (that's grammatical, this is audio).
  voice_gender: 'male' | 'female' | null;
  // Chosen natural voice (key of services/audio/voices.ts's catalog) - NULL = default for voice_gender.
  voice_id: string | null;
  // Web portal credentials (see services/auth/web-auth.service.ts). Login = WhatsApp number; NULL hash = no
  // password set yet (can't log in). must_change_password = temporary password handed out by the
  // admin/bot, the portal forces a change before anything else.
  password_hash: string | null;
  must_change_password: number;
  // Free trial created from the public landing page (see services/growth/demo.service.ts): when it ends (UTC ISO),
  // and 'active' | 'expired' | NULL (not a demo account / converted into a real customer).
  demo_expires_at: string | null;
  demo_status: 'active' | 'expired' | null;
  // Administrator only: JSON { label, permissions, since } while trying the bot with a reduced set
  // of permissions (see services/permissions/test-mode.service.ts). NULL = off.
  test_mode: string | null;
  password_updated_at: string | null;
  failed_logins: number;
  locked_until: string | null;
  created_at: string;
}
