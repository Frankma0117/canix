import { db } from '../pool.js';
import type { HabitLog } from '../../types/index.js';

export const habitLogsRepo = {
  /** Marks a routine as done (or not) for a given day; idempotent per (todo, day). */
  checkIn(todoId: number, logDate: string, done: boolean, note: string | null): void {
    db.prepare(
      `INSERT INTO habit_logs (todo_id, log_date, done, note) VALUES (?, ?, ?, ?)
       ON CONFLICT(todo_id, log_date) DO UPDATE SET done = excluded.done, note = excluded.note`,
    ).run(todoId, logDate, done ? 1 : 0, note);
  },

  getForDate(todoId: number, logDate: string): HabitLog | undefined {
    return db
      .prepare('SELECT * FROM habit_logs WHERE todo_id = ? AND log_date = ?')
      .get(todoId, logDate) as HabitLog | undefined;
  },

  /** Last N days of history for a routine, most recent first. */
  history(todoId: number, days: number): HabitLog[] {
    return db
      .prepare(
        `SELECT * FROM habit_logs WHERE todo_id = ? ORDER BY log_date DESC LIMIT ?`,
      )
      .all(todoId, days) as HabitLog[];
  },

  /** Current consecutive-day streak of "done" check-ins, ending today or yesterday. */
  currentStreak(todoId: number, todayDate: string): number {
    const rows = db
      .prepare(
        `SELECT log_date, done FROM habit_logs WHERE todo_id = ? AND done = 1 ORDER BY log_date DESC`,
      )
      .all(todoId) as { log_date: string; done: number }[];
    if (rows.length === 0) return 0;

    let streak = 0;
    let cursor = new Date(`${todayDate}T00:00:00Z`);
    // Allow the streak to still count if today hasn't been checked in yet.
    if (rows[0].log_date !== todayDate) {
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    for (const row of rows) {
      const expected = cursor.toISOString().slice(0, 10);
      if (row.log_date !== expected) break;
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return streak;
  },
};
