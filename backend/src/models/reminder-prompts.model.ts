import { db } from '../database/connection.js';
import type { PromptAnswer, PromptSource, ReminderPrompt, ReminderResponse } from '../entities/index.js';

export interface PromptWithResponses extends Omit<ReminderPrompt, 'poll_secret'> {
  responses: ReminderResponse[];
}

/** Keep roughly a year of answer history per person - plenty for the portal's timeline. */
const KEEP_DAYS = 400;

export const reminderPromptsModel = {
  create(fields: {
    userId: number;
    reminderId: number | null;
    todoId: number | null;
    medicationId?: number | null;
    title: string;
    occurrenceDate: string;
    sentAt: string | null;
    textMsgId?: string | null;
  }): ReminderPrompt {
    const info = db
      .prepare(
        `INSERT INTO reminder_prompts (user_id, reminder_id, todo_id, medication_id, title, occurrence_date, sent_at, text_msg_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fields.userId,
        fields.reminderId,
        fields.todoId,
        fields.medicationId ?? null,
        fields.title,
        fields.occurrenceDate,
        fields.sentAt,
        fields.textMsgId ?? null,
      );
    db.prepare(`DELETE FROM reminder_prompts WHERE user_id = ? AND occurrence_date < date('now', ?)`).run(fields.userId, `-${KEEP_DAYS} days`);
    return this.getById(Number(info.lastInsertRowid))!;
  },

  getById(id: number): ReminderPrompt | undefined {
    return db.prepare('SELECT * FROM reminder_prompts WHERE id = ?').get(id) as ReminderPrompt | undefined;
  },

  /** The prompt a WhatsApp message belongs to - the poll itself or the reminder text above it. */
  findByMessageId(userId: number, messageId: string): ReminderPrompt | undefined {
    return db
      .prepare('SELECT * FROM reminder_prompts WHERE user_id = ? AND (poll_msg_id = ? OR text_msg_id = ?) ORDER BY id DESC LIMIT 1')
      .get(userId, messageId, messageId) as ReminderPrompt | undefined;
  },

  /** Latest prompt of a routine for a given day (there's normally just one). */
  findForRoutineDate(todoId: number, occurrenceDate: string): ReminderPrompt | undefined {
    return db
      .prepare('SELECT * FROM reminder_prompts WHERE todo_id = ? AND occurrence_date = ? ORDER BY id DESC LIMIT 1')
      .get(todoId, occurrenceDate) as ReminderPrompt | undefined;
  },

  /** A medication's doses for a range of days, oldest first (adherence history). */
  listForMedication(medicationId: number, fromDate: string): ReminderPrompt[] {
    return db
      .prepare('SELECT * FROM reminder_prompts WHERE medication_id = ? AND occurrence_date >= ? ORDER BY occurrence_date, sent_at')
      .all(medicationId, fromDate) as ReminderPrompt[];
  },

  /** Stores the new current answer and appends it to the sequence, together. */
  setAnswer(promptId: number, answer: PromptAnswer, source: PromptSource, at: string): void {
    db.transaction(() => {
      db.prepare('UPDATE reminder_prompts SET answer = ?, answered_at = ?, answer_source = ? WHERE id = ?').run(answer, at, source, promptId);
      db.prepare('INSERT INTO reminder_responses (prompt_id, answer, source, created_at) VALUES (?, ?, ?, ?)').run(promptId, answer, source, at);
    })();
  },

  /** Newest first, each with its full sequence of answers (oldest first). */
  listWithResponses(userId: number, filters: { todoId?: number; limit?: number } = {}): PromptWithResponses[] {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (filters.todoId !== undefined) {
      where.push('todo_id = ?');
      params.push(filters.todoId);
    }
    params.push(Math.min(Math.max(filters.limit ?? 30, 1), 200));
    const prompts = db
      .prepare(
        `SELECT id, user_id, reminder_id, todo_id, medication_id, title, occurrence_date, sent_at, text_msg_id, poll_msg_id, answer, answered_at, answer_source, created_at
         FROM reminder_prompts WHERE ${where.join(' AND ')} ORDER BY occurrence_date DESC, id DESC LIMIT ?`,
      )
      .all(...params) as Omit<ReminderPrompt, 'poll_secret'>[];
    if (prompts.length === 0) return [];
    const marks = prompts.map(() => '?').join(',');
    const responses = db
      .prepare(`SELECT * FROM reminder_responses WHERE prompt_id IN (${marks}) ORDER BY id`)
      .all(...prompts.map((p) => p.id)) as ReminderResponse[];
    return prompts.map((p) => ({ ...p, responses: responses.filter((r) => r.prompt_id === p.id) }));
  },
};
