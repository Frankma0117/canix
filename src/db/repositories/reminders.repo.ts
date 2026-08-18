import { db } from '../pool.js';
import type { Reminder, DueReminder, RecurrenceFreq, ReminderStatus, ReminderKind } from '../../types/index.js';

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

  /** Pending reminders whose run_at has already passed (or equals now) - across all users, for the
   *  scheduler. Joins the owning user's paused_until too (aliased user_paused_until) so tick() can
   *  see both pause sources without an extra query per reminder - deliberately NOT filtered out
   *  here, since the scheduler needs to see paused-but-due rows to decide how to skip them. */
  listDue(nowWall: string): DueReminder[] {
    return db
      .prepare(
        `SELECT r.*, u.paused_until AS user_paused_until
         FROM reminders r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending' AND r.run_at <= ?
         ORDER BY r.run_at`,
      )
      .all(nowWall) as DueReminder[];
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
      intervalSeconds?: number | null;
      repeatCount?: number | null;
      withAudio?: boolean;
    },
  ): number {
    const info = db
      .prepare(
        `INSERT INTO reminders
         (user_id, message, run_at, target_jid, category_id, recurrence_freq, recurrence_interval, kind, window_start, window_end, todo_id, link_id, interval_seconds, repeat_count, with_audio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        fields.intervalSeconds ?? null,
        fields.repeatCount ?? null,
        fields.withAudio ? 1 : 0,
      );
    return Number(info.lastInsertRowid);
  },

  /** Advances an interval reminder (kind 'interval') to its next occurrence, or marks it executed
   *  once repeat_count is reached - always bumping fired_count either way (see task-scheduler.ts). */
  advanceInterval(id: number, nextRunAt: string | null): void {
    if (nextRunAt) {
      db.prepare("UPDATE reminders SET run_at = ?, status = 'pending', fired_count = fired_count + 1 WHERE id = ?").run(
        nextRunAt,
        id,
      );
    } else {
      db.prepare("UPDATE reminders SET status = 'executed', fired_count = fired_count + 1 WHERE id = ?").run(id);
    }
  },

  /** Partial update for a reminder's editable fields (message/time/recurrence/target/category, plus
   *  the flexible-window and interval-specific fields when they apply to that reminder's kind - see
   *  edit-reminder.tool.ts, which is the only caller that ever passes those). */
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
      windowStart?: string;
      windowEnd?: string;
      intervalSeconds?: number;
      repeatCount?: number;
      withAudio?: boolean;
    },
  ): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare(
      `UPDATE reminders SET message = ?, run_at = ?, target_jid = ?, category_id = ?,
       recurrence_freq = ?, recurrence_interval = ?, window_start = ?, window_end = ?,
       interval_seconds = ?, repeat_count = ?, with_audio = ?, status = 'pending' WHERE id = ? AND user_id = ?`,
    ).run(
      fields.message ?? current.message,
      fields.runAt ?? current.run_at,
      fields.targetJid === undefined ? current.target_jid : fields.targetJid,
      fields.categoryId === undefined ? current.category_id : fields.categoryId,
      fields.recurrenceFreq ?? current.recurrence_freq,
      fields.recurrenceInterval ?? current.recurrence_interval,
      fields.windowStart ?? current.window_start,
      fields.windowEnd ?? current.window_end,
      fields.intervalSeconds ?? current.interval_seconds,
      fields.repeatCount ?? current.repeat_count,
      fields.withAudio === undefined ? current.with_audio : fields.withAudio ? 1 : 0,
      id,
      userId,
    );
  },

  /** Pauses (or clears, with null) a single reminder - see pause-reminder.tool.ts / pause-routine.tool.ts. */
  setPausedUntil(userId: number, id: number, until: string | null): void {
    db.prepare('UPDATE reminders SET paused_until = ? WHERE id = ? AND user_id = ?').run(until, id, userId);
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
