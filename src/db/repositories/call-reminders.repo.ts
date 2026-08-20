import { db } from '../pool.js';
import type { CallReminder, CallReminderStatus, CallReminderType, RecurrenceFreq } from '../../types/index.js';

export interface CallReminderEditableFields {
  phoneNumber?: string;
  message?: string;
  callType?: CallReminderType;
  scheduledAt?: string;
  recurrenceFreq?: RecurrenceFreq;
  recurrenceInterval?: number;
}

export const callRemindersRepo = {
  listAll(userId: number, status?: CallReminderStatus): CallReminder[] {
    if (!status) {
      return db
        .prepare('SELECT * FROM call_reminders WHERE user_id = ? ORDER BY scheduled_at DESC')
        .all(userId) as CallReminder[];
    }
    return db
      .prepare('SELECT * FROM call_reminders WHERE user_id = ? AND status = ? ORDER BY scheduled_at DESC')
      .all(userId, status) as CallReminder[];
  },

  getById(userId: number, id: number): CallReminder | undefined {
    return db.prepare('SELECT * FROM call_reminders WHERE id = ? AND user_id = ?').get(id, userId) as
      | CallReminder
      | undefined;
  },

  /** Unscoped lookup by id - only for the scheduler tick and the Twilio webhook, neither of which
   *  has a userId to check against (a call in flight belongs to whichever user created it, not to
   *  whoever happens to be polling the API right now). */
  getByIdUnscoped(id: number): CallReminder | undefined {
    return db.prepare('SELECT * FROM call_reminders WHERE id = ?').get(id) as CallReminder | undefined;
  },

  /** Pending call reminders whose scheduled_at has already passed (or equals now) - across all
   *  users, for the scheduler tick (see scheduler/task-scheduler.ts). */
  listDue(nowWall: string): CallReminder[] {
    return db
      .prepare("SELECT * FROM call_reminders WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at")
      .all(nowWall) as CallReminder[];
  },

  /**
   * Idempotent create: reuses an existing still-pending row with the exact same
   * (user, phone, message, scheduled_at) instead of inserting a duplicate - guards against a
   * double form submit / double API call creating two identical calls for the same moment.
   */
  create(
    userId: number,
    phoneNumber: string,
    message: string,
    callType: CallReminderType,
    scheduledAt: string,
    recurrenceFreq: RecurrenceFreq = 'none',
    recurrenceInterval = 1,
  ): CallReminder {
    const existing = db
      .prepare(
        `SELECT * FROM call_reminders
         WHERE user_id = ? AND phone_number = ? AND message = ? AND call_type = ? AND scheduled_at = ?
           AND recurrence_freq = ? AND recurrence_interval = ? AND status = 'pending'`,
      )
      .get(userId, phoneNumber, message, callType, scheduledAt, recurrenceFreq, recurrenceInterval) as
      | CallReminder
      | undefined;
    if (existing) return existing;

    const info = db
      .prepare(
        `INSERT INTO call_reminders (user_id, phone_number, message, call_type, scheduled_at, recurrence_freq, recurrence_interval)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, phoneNumber, message, callType, scheduledAt, recurrenceFreq, recurrenceInterval);
    return this.getByIdUnscoped(Number(info.lastInsertRowid))!;
  },

  /**
   * Partial update of any editable field - only while not mid-call ('processing'), so an edit can
   * never race a Twilio call already in flight. Editing a reminder that already finished one way
   * or another (completed/failed/cancelled) revives it back to 'pending' with a clean slate
   * (attempts/twilio_call_sid/twilio_call_status/last_error reset) - the whole point of editing one
   * is to have it fire again, not to silently keep it inert in its old terminal state. Returns
   * false (no-op) if the row doesn't exist, isn't this user's, or is currently processing.
   */
  update(userId: number, id: number, fields: CallReminderEditableFields): boolean {
    const current = this.getById(userId, id);
    if (!current || current.status === 'processing') return false;

    const revive = current.status !== 'pending';
    db.prepare(
      `UPDATE call_reminders
       SET phone_number = ?, message = ?, call_type = ?, scheduled_at = ?,
           recurrence_freq = ?, recurrence_interval = ?, updated_at = datetime('now')
           ${revive ? ", status = 'pending', attempts = 0, twilio_call_sid = NULL, twilio_call_status = NULL, last_error = NULL" : ''}
       WHERE id = ? AND user_id = ?`,
    ).run(
      fields.phoneNumber ?? current.phone_number,
      fields.message ?? current.message,
      fields.callType ?? current.call_type,
      fields.scheduledAt ?? current.scheduled_at,
      fields.recurrenceFreq ?? current.recurrence_freq,
      fields.recurrenceInterval ?? current.recurrence_interval,
      id,
      userId,
    );
    return true;
  },

  /**
   * Atomically claims a pending call reminder for processing - the WHERE status = 'pending' makes
   * this safe even if called twice concurrently for the same row (only the first UPDATE actually
   * changes anything; better-sqlite3 statements are synchronous, so there's no race window between
   * the check and the write). Returns true only if THIS call is the one that claimed it.
   */
  claim(id: number): boolean {
    const info = db
      .prepare(`UPDATE call_reminders SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .run(id);
    return info.changes > 0;
  },

  setCallSid(id: number, callSid: string): void {
    db.prepare(`UPDATE call_reminders SET twilio_call_sid = ?, updated_at = datetime('now') WHERE id = ?`).run(callSid, id);
  },

  /** Counts one more attempt (whether the dispatch to Twilio's API succeeded or not - see
   *  calls/call-reminders.service.ts) and returns the new total, so the caller can decide
   *  retry-vs-give-up against env.twilio.maxAttempts without a second query. */
  incrementAttempts(id: number): number {
    db.prepare(`UPDATE call_reminders SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`).run(id);
    return this.getByIdUnscoped(id)!.attempts;
  },

  /**
   * Records Twilio's own call-progress status (from the status callback webhook, see
   * server/twilio-webhook.ts) - only sets this row's own `status` to 'completed' when Twilio
   * itself reports the call actually completed, never earlier (see the table's own comment on why
   * accepting the API request is not the same as the call happening).
   */
  updateTwilioStatus(callSid: string, twilioCallStatus: string): CallReminder | undefined {
    const reminder = db.prepare('SELECT * FROM call_reminders WHERE twilio_call_sid = ?').get(callSid) as
      | CallReminder
      | undefined;
    if (!reminder) return undefined;

    const finalStatus = twilioCallStatus === 'completed' ? 'completed' : reminder.status;
    db.prepare(
      `UPDATE call_reminders SET twilio_call_status = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(twilioCallStatus, finalStatus, reminder.id);
    return this.getByIdUnscoped(reminder.id);
  },

  /** A recurring call reminder that Twilio just confirmed actually completed - advances it to its
   *  next occurrence (fresh attempts/twilio fields) instead of leaving it 'completed' forever. See
   *  calls/call-reminders.service.ts's nextCallScheduledAt for how nextScheduledAt is computed. */
  rescheduleRecurring(id: number, nextScheduledAt: string): void {
    db.prepare(
      `UPDATE call_reminders
       SET status = 'pending', scheduled_at = ?, attempts = 0, twilio_call_sid = NULL,
           twilio_call_status = NULL, last_error = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(nextScheduledAt, id);
  },

  /** A failed/busy/no-answer call, out of retries - permanent failure. attempts is NOT touched
   *  here - increment it separately (see incrementAttempts()) before deciding this vs a retry. */
  markFailed(id: number, errorMessage: string): void {
    db.prepare(
      `UPDATE call_reminders SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(errorMessage.slice(0, 500), id);
  },

  /** A failed/busy/no-answer call that still has retries left - back to 'pending' at a later time.
   *  attempts is NOT touched here either, same reasoning as markFailed(). */
  rescheduleForRetry(id: number, nextScheduledAt: string, errorMessage: string): void {
    db.prepare(
      `UPDATE call_reminders SET status = 'pending', scheduled_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(nextScheduledAt, errorMessage.slice(0, 500), id);
  },

  /** Only cancels while still pending/processing - a call that already completed or already
   *  permanently failed is history, not something "cancel" should silently rewrite. */
  cancel(userId: number, id: number): boolean {
    const info = db
      .prepare(
        `UPDATE call_reminders SET status = 'cancelled', updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'processing')`,
      )
      .run(id, userId);
    return info.changes > 0;
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM call_reminders WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
