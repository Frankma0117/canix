import { db } from '../pool.js';
import type { Reminder, RecurrenceFreq, ReminderStatus, ReminderKind } from '../../types/index.js';

export const remindersRepo = {
  listAll(userId: number, status?: ReminderStatus): Reminder[] {
    if (!status) {
      return db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY run_at').all(userId) as Reminder[];
    }
    return db
      .prepare('SELECT * FROM reminders WHERE user_id = ? AND status = ? ORDER BY run_at')
      .all(userId, status) as Reminder[];
  },

  listByCategory(userId: number, categoryId: number, status?: ReminderStatus): Reminder[] {
    if (!status) {
      return db
        .prepare('SELECT * FROM reminders WHERE user_id = ? AND category_id = ? ORDER BY run_at')
        .all(userId, categoryId) as Reminder[];
    }
    return db
      .prepare('SELECT * FROM reminders WHERE user_id = ? AND category_id = ? AND status = ? ORDER BY run_at')
      .all(userId, categoryId, status) as Reminder[];
  },

  getById(userId: number, id: number): Reminder | undefined {
    return db
      .prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?')
      .get(id, userId) as Reminder | undefined;
  },

  listByTodo(todoId: number): Reminder[] {
    return db.prepare('SELECT * FROM reminders WHERE todo_id = ?').all(todoId) as Reminder[];
  },

  /** Pending reminders whose run_at has already passed (or equals now) - across all users, for the scheduler. */
  listDue(nowWall: string): Reminder[] {
    return db
      .prepare(`SELECT * FROM reminders WHERE status = 'pending' AND run_at <= ? ORDER BY run_at`)
      .all(nowWall) as Reminder[];
  },

  create(
    userId: number,
    fields: {
      message: string;
      runAt: string;
      targetJid: string | null;
      categoryId: number | null;
      recurrenceFreq: RecurrenceFreq;
      recurrenceInterval: number;
      kind?: ReminderKind;
      windowStart?: string | null;
      windowEnd?: string | null;
      todoId?: number | null;
      linkId?: number | null;
    },
  ): number {
    const info = db
      .prepare(
        `INSERT INTO reminders
         (user_id, message, run_at, target_jid, category_id, recurrence_freq, recurrence_interval, kind, window_start, window_end, todo_id, link_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        fields.message,
        fields.runAt,
        fields.targetJid,
        fields.categoryId,
        fields.recurrenceFreq,
        fields.recurrenceInterval,
        fields.kind ?? 'reminder',
        fields.windowStart ?? null,
        fields.windowEnd ?? null,
        fields.todoId ?? null,
        fields.linkId ?? null,
      );
    return Number(info.lastInsertRowid);
  },

  /** Partial update for a plain reminder's editable fields (message/time/recurrence/target/category). */
  update(
    userId: number,
    id: number,
    fields: {
      message?: string;
      runAt?: string;
      targetJid?: string | null;
      categoryId?: number | null;
      recurrenceFreq?: RecurrenceFreq;
      recurrenceInterval?: number;
    },
  ): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare(
      `UPDATE reminders SET message = ?, run_at = ?, target_jid = ?, category_id = ?,
       recurrence_freq = ?, recurrence_interval = ?, status = 'pending' WHERE id = ? AND user_id = ?`,
    ).run(
      fields.message ?? current.message,
      fields.runAt ?? current.run_at,
      fields.targetJid === undefined ? current.target_jid : fields.targetJid,
      fields.categoryId === undefined ? current.category_id : fields.categoryId,
      fields.recurrenceFreq ?? current.recurrence_freq,
      fields.recurrenceInterval ?? current.recurrence_interval,
      id,
      userId,
    );
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

  cancel(userId: number, id: number): void {
    db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND user_id = ?").run(id, userId);
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
