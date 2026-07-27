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

export interface Reminder {
  id: number;
  message: string;
  run_at: string; // 'YYYY-MM-DD HH:mm:ss' local time, next fire time
  target_jid: string | null; // null = owner
  category_id: number | null;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  status: ReminderStatus;
  created_at: string;
}

export type TodoScope = 'today' | 'later' | 'routine';
export type TodoStatus = 'pending' | 'done' | 'skipped';

export interface Todo {
  id: number;
  title: string;
  category_id: number | null;
  scope: TodoScope;
  due_date: string | null; // 'YYYY-MM-DD'
  recurrence_freq: RecurrenceFreq | null; // used when scope === 'routine'
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
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface Owner {
  id: 1;
  jid: string;
  name: string | null;
  created_at: string;
}
