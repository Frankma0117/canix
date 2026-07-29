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

export interface Contact {
  id: number;
  user_id: number;
  name: string;
  jid: string;
  lid: string | null;
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
  | 'daily_agenda';

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
  created_at: string;
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
