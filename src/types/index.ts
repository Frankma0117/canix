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
  // JSON-encoded array of tool names this user is limited to (see set-user-permissions.tool.ts).
  // NULL = unrestricted (full access) - always the case for the admin.
  allowed_tools: string | null;
  // Random per-user token for the web panel (see server/auth.ts) - each granted user gets their
  // own, scoped to only their own data, instead of everyone sharing one admin-only token.
  panel_token: string | null;
  // WhatsApp's public @username handle, if known - reference/search label only, same limitation as
  // Contact.username (see contacts.repo.ts's getByUsername).
  username: string | null;
  // Set = every scheduled notification for this person is silenced until this moment (see
  // pause-notifications.tool.ts / task-scheduler.ts). NULL = not paused.
  paused_until: string | null;
  created_at: string;
}

export interface Category {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Link {
  id: number;
  user_id: number;
  category_id: number | null;
  url: string;
  title: string | null;
  description: string | null;
  used_count: number;
  last_used_at: string | null;
  created_at: string;
}

/** A free-text "important note" (idea, piece of info, something to remember) - NOT a task or
 *  reminder: no date, no time, no status, just content to find again later (see notes.repo.ts). */
export interface Note {
  id: number;
  user_id: number;
  category_id: number | null;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  user_id: number;
  name: string;
  jid: string;
  lid: string | null;
  // WhatsApp's public @username handle, if known - reference/search label only, see contacts.repo.ts.
  username: string | null;
  notes: string | null;
  created_at: string;
}

export type ReminderStatus = 'pending' | 'executed' | 'failed' | 'cancelled';
export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ReminderKind =
  | 'reminder'
  | 'important_date'
  | 'flexible'
  | 'routine_reminder'
  | 'routine_checkin'
  // One per user, auto-created on bootstrap/grant_access: fires daily at MORNING_SUMMARY_TIME.
  // Its `message` is ignored at send time - task-scheduler.ts builds the agenda text fresh every
  // time from that day's routines/todos/reminders (see agent/agenda.ts).
  | 'daily_agenda'
  // One per user, auto-created on bootstrap/grant_access: fires weekly (WEEKLY_REPORT_DAY/TIME).
  // Same "ignore stored message, build fresh at send time" pattern as daily_agenda - see
  // agent/weekly-report.ts.
  | 'weekly_report'
  // Short-cycle repeating alert (e.g. "avísame cada 30s, 5 veces, para cambiar de serie") - see
  // interval_seconds/repeat_count/fired_count below and schedule-interval-reminder.tool.ts. Stop
  // it early with cancel_reminder/delete_reminder like any other pending reminder. NOT pausable
  // (see pause-reminder.tool.ts) - a short-cycle timer has no sensible "resume days later" meaning.
  | 'interval'
  // One per user, auto-created on bootstrap/grant_access: silently clears that day's conversation
  // history (messages table only - never touches todos/reminders/etc.) once a day at
  // DAILY_RESET_TIME. Never sends a WhatsApp message - see agent/daily-reset.ts.
  | 'daily_reset'
  // One per user, auto-created on bootstrap/grant_access: silently merges/removes duplicate
  // routines and reminders once a day at DAILY_DEDUP_TIME. Never sends a WhatsApp message - see
  // agent/dedup.ts.
  | 'daily_dedup';

export interface Reminder {
  id: number;
  user_id: number;
  // Set only for the reminder_time / checkin pair auto-created by a routine (kind
  // 'routine_reminder' / 'routine_checkin') - deleting the routine cascades and removes both.
  todo_id: number | null;
  // Optional reference to a saved link (see save_link/list_links) - lets a reminder point at
  // "haz el ejercicio de tal link" without repeating the URL in the message.
  link_id: number | null;
  message: string;
  run_at: string; // 'YYYY-MM-DD HH:mm:ss' local time, next fire time
  target_jid: string | null; // null = owner
  category_id: number | null;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  status: ReminderStatus;
  kind: ReminderKind;
  // Only set for kind === 'flexible': run_at's time is re-randomized within this 'HH:mm' window
  // on every recurrence instead of repeating at the same clock time (see task-scheduler.ts).
  window_start: string | null;
  window_end: string | null;
  // Only used for kind === 'interval': how many seconds between each fire, and the total number of
  // times to fire before stopping on its own (fired_count tracks progress - see task-scheduler.ts).
  interval_seconds: number | null;
  repeat_count: number | null;
  fired_count: number;
  // Only used for kind === 'interval': also send a local-TTS voice note alongside the text on each
  // fire (no AI/tokens - see audio/tts.ts). Silently a no-op if Piper isn't configured.
  with_audio: number;
  // Set = this specific reminder is silenced until this moment (see pause-reminder.tool.ts /
  // pause-routine.tool.ts). NULL = not paused. A user-level pause (users.paused_until) also
  // silences this row even when this column itself is NULL - see task-scheduler.ts.
  paused_until: string | null;
  created_at: string;
}

/** Row shape of remindersRepo.listDue()'s join - the owning user's pause state alongside the
 *  reminder's own, so task-scheduler.ts can check both without an extra query per reminder. */
export interface DueReminder extends Reminder {
  user_paused_until: string | null;
}

export type TodoScope = 'today' | 'later' | 'routine';
export type TodoStatus = 'pending' | 'done' | 'skipped';

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  category_id: number | null;
  // Optional reference to a saved link (see save_link/list_links) - e.g. "mañana a la hora de
  // almuerzo hago el ejercicio de tal link" attaches that link to the todo/routine.
  link_id: number | null;
  scope: TodoScope;
  due_date: string | null; // 'YYYY-MM-DD'
  recurrence_freq: RecurrenceFreq | null; // used when scope === 'routine'
  // Only used for scope === 'routine': mandatory reminder time ('HH:mm') and how long you have
  // before the bot asks for a check-in (see create-routine.tool.ts / task-scheduler.ts).
  reminder_time: string | null;
  duration_minutes: number | null;
  status: TodoStatus;
  completed_at: string | null;
  created_at: string;
}

export interface HabitLog {
  id: number;
  todo_id: number;
  log_date: string; // 'YYYY-MM-DD'
  done: number;
  note: string | null;
  created_at: string;
}

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: number;
  user_id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

/** @deprecated Replaced by `users` (see migrateToMultiUser in db/init.ts). Kept only as the migration source. */
export interface Owner {
  id: 1;
  jid: string;
  name: string | null;
  created_at: string;
}

/** One exercise within a routine (scope='routine' todo) - see exercises.repo.ts. */
export interface Exercise {
  id: number;
  user_id: number;
  todo_id: number;
  name: string;
  sets: number | null;
  reps: number | null;
  seconds: number | null; // for time-based exercises (plancha, etc.) instead of reps
  weight_kg: number | null;
  order_index: number;
  created_at: string;
}

export type MealSlot = 'desayuno' | 'almuerzo' | 'cena' | 'onces';

export interface MealPlan {
  id: number;
  user_id: number;
  plan_date: string; // 'YYYY-MM-DD'
  meal_slot: MealSlot;
  title: string;
  notes: string | null;
  created_at: string;
}

export interface Recipe {
  id: number;
  user_id: number;
  title: string;
  ingredients: string;
  instructions: string;
  category_id: number | null;
  created_at: string;
}

/** Fashion Mode (armario/outfits) - see src/fashion/. Taxonomy values (type/category/style/etc.)
 *  are validated at the app layer against src/fashion/taxonomy.ts, not a DB CHECK constraint, so
 *  new categories are a one-line code change instead of a migration. */
export interface Garment {
  id: number;
  user_id: number;
  public_id: string;
  storage_key: string;
  image_url: string;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  type: string;
  category: string;
  subcategory: string | null;
  gender: string | null;
  color: string | null;
  secondary_colors: string | null; // JSON array
  pattern: string | null;
  material: string | null;
  fit: string | null;
  style: string | null; // JSON array
  formality: string | null;
  season: string | null; // JSON array
  weather: string | null; // JSON array
  occasions: string | null; // JSON array
  brand: string | null;
  size: string | null;
  condition: string | null;
  warmth: string | null;
  water_resistance: string | null;
  is_active: number;
  favorite: number;
  notes: string | null;
  ai_metadata: string | null; // JSON: raw vision-service response, audit/debug only
  created_at: string;
  updated_at: string;
}

/** One row per user (1:1) - Fashion Mode's own conversational state (FASHION_HOME,
 *  FASHION_ADD_GARMENT_WAITING_IMAGE, etc. - see src/fashion/types.ts). */
export interface FashionSession {
  user_id: number;
  state: string;
  data: string; // JSON
  updated_at: string;
}

/** A saved combination of garments - only persisted when the user explicitly saves one (see
 *  fashion/flows/outfit.flow.ts). */
export interface Outfit {
  id: number;
  user_id: number;
  name: string | null;
  occasion: string | null;
  formality: string | null;
  season: string | null;
  style: string | null;
  notes: string | null;
  favorite: number;
  ai_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutfitGarment {
  id: number;
  outfit_id: number;
  garment_id: number;
  role: string; // matches src/fashion/taxonomy.ts's GarmentType
}

/** Token/cost visibility for Fashion Mode's AI calls (see fashion/outfit/recommendation.service.ts
 *  and fashion/outfit/intent.ts) - separate from the general [LLM] console log in ai-agent.ts. */
export interface AiUsage {
  id: number;
  user_id: number | null;
  operation: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export type RewardPunishmentType = 'reward' | 'punishment';

export interface RewardPunishment {
  id: number;
  user_id: number;
  todo_id: number | null; // linked routine/habit, if any
  type: RewardPunishmentType;
  description: string;
  note: string | null;
  date: string; // 'YYYY-MM-DD'
  created_at: string;
}
