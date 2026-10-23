import type { RecurrenceFreq } from './reminder.entity.js';

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
  // Routine schedule details (see services/routines/routine-schedule.ts): weekdays as "1,3,5" (0 = domingo),
  // every how many days/weeks/months, day of the month for monthly ones, and the anchor date.
  weekdays: string | null;
  recurrence_interval: number;
  month_day: number | null;
  start_date: string | null; // 'YYYY-MM-DD'
  status: TodoStatus;
  completed_at: string | null;
  created_at: string;
}

/** @public - domain record shape, read by its model. */
export interface HabitLog {
  id: number;
  todo_id: number;
  log_date: string; // 'YYYY-MM-DD'
  done: number;
  note: string | null;
  created_at: string;
}
