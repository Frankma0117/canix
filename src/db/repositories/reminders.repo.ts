import { db } from '../pool.js';
import type { Reminder, RecurrenceFreq, ReminderStatus } from '../../types/index.js';

export const remindersRepo = {
  listAll(status?: ReminderStatus): Reminder[] {
    if (!status) return db.prepare('SELECT * FROM reminders ORDER BY run_at').all() as Reminder[];
    return db
      .prepare('SELECT * FROM reminders WHERE status = ? ORDER BY run_at')
      .all(status) as Reminder[];
  },

  listByCategory(categoryId: number, status?: ReminderStatus): Reminder[] {
    if (!status) {
      return db
        .prepare('SELECT * FROM reminders WHERE category_id = ? ORDER BY run_at')
        .all(categoryId) as Reminder[];
    }
    return db
      .prepare('SELECT * FROM reminders WHERE category_id = ? AND status = ? ORDER BY run_at')
      .all(categoryId, status) as Reminder[];
  },

  getById(id: number): Reminder | undefined {
    return db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Reminder | undefined;
  },

  /** Pending reminders whose run_at has already passed (or equals now). */
  listDue(nowWall: string): Reminder[] {
    return db
      .prepare(`SELECT * FROM reminders WHERE status = 'pending' AND run_at <= ? ORDER BY run_at`)
      .all(nowWall) as Reminder[];
  },

  create(fields: {
    message: string;
    runAt: string;
    targetJid: string | null;
    categoryId: number | null;
    recurrenceFreq: RecurrenceFreq;
    recurrenceInterval: number;
  }): number {
    const info = db
      .prepare(
        `INSERT INTO reminders
         (message, run_at, target_jid, category_id, recurrence_freq, recurrence_interval)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fields.message,
        fields.runAt,
        fields.targetJid,
        fields.categoryId,
        fields.recurrenceFreq,
        fields.recurrenceInterval,
      );
    return Number(info.lastInsertRowid);
  },

  /** Reschedules a recurring reminder to its next run_at, keeping it pending. */
  reschedule(id: number, nextRunAt: string): void {
    db.prepare("UPDATE reminders SET run_at = ?, status = 'pending' WHERE id = ?").run(
      nextRunAt,
      id,
    );
  },

  markStatus(id: number, status: ReminderStatus): void {
    db.prepare('UPDATE reminders SET status = ? WHERE id = ?').run(status, id);
  },

  cancel(id: number): void {
    this.markStatus(id, 'cancelled');
  },
};
