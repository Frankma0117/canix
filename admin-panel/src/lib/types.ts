export interface Category {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Link {
  id: number;
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
  name: string;
  jid: string;
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
  | 'daily_agenda';

export interface Reminder {
  id: number;
  message: string;
  run_at: string;
  target_jid: string | null;
  category_id: number | null;
  link_id: number | null;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  status: ReminderStatus;
  kind: ReminderKind;
  window_start: string | null;
  window_end: string | null;
  created_at: string;
}

export type TodoScope = 'today' | 'later' | 'routine';
export type TodoStatus = 'pending' | 'done' | 'skipped';

export interface Todo {
  id: number;
  title: string;
  category_id: number | null;
  link_id: number | null;
  scope: TodoScope;
  due_date: string | null;
  recurrence_freq: RecurrenceFreq | null;
  reminder_time: string | null;
  duration_minutes: number | null;
  status: TodoStatus;
  completed_at: string | null;
  created_at: string;
}

export interface HabitLog {
  id: number;
  todo_id: number;
  log_date: string;
  done: number;
  note: string | null;
  created_at: string;
}

export type RewardPunishmentType = 'reward' | 'punishment';

export interface RewardPunishment {
  id: number;
  todo_id: number | null;
  type: RewardPunishmentType;
  description: string;
  note: string | null;
  date: string;
  created_at: string;
}
