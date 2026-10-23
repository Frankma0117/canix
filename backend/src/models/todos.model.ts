import { db } from '../database/connection.js';
import { nowLocal } from '../shared/utils/datetime.js';
import type { RecurrenceFreq, Todo, TodoScope, TodoStatus, WorkoutKind } from '../entities/index.js';

export const todosModel = {
  list(userId: number, filters: { scope?: TodoScope; status?: TodoStatus; categoryId?: number } = {}): Todo[] {
    const clauses: string[] = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (filters.scope) {
      clauses.push('scope = ?');
      params.push(filters.scope);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.categoryId !== undefined) {
      clauses.push('category_id = ?');
      params.push(filters.categoryId);
    }
    return db
      .prepare(`SELECT * FROM todos WHERE ${clauses.join(' AND ')} ORDER BY due_date IS NULL, due_date, created_at`)
      .all(...params) as Todo[];
  },

  getById(userId: number, id: number): Todo | undefined {
    return db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, userId) as Todo | undefined;
  },

  create(
    userId: number,
    fields: {
      title: string;
      categoryId: number | null;
      scope: TodoScope;
      dueDate: string | null;
      recurrenceFreq?: RecurrenceFreq | null;
      reminderTime?: string | null;
      durationMinutes?: number | null;
      linkId?: number | null;
      weekdays?: string | null;
      recurrenceInterval?: number;
      monthDay?: number | null;
      startDate?: string | null;
    },
  ): number {
    const info = db
      .prepare(
        `INSERT INTO todos (user_id, title, category_id, scope, due_date, recurrence_freq, reminder_time, duration_minutes, link_id,
                            weekdays, recurrence_interval, month_day, start_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        fields.title,
        fields.categoryId,
        fields.scope,
        fields.dueDate,
        fields.recurrenceFreq ?? null,
        fields.reminderTime ?? null,
        fields.durationMinutes ?? null,
        fields.linkId ?? null,
        fields.weekdays ?? null,
        fields.recurrenceInterval ?? 1,
        fields.monthDay ?? null,
        fields.startDate ?? null,
      );
    return Number(info.lastInsertRowid);
  },

  /** Partial update for a plain (non-routine) todo's editable fields - use updateRoutineWithReminders
   *  for scope 'routine' instead, since that also needs to move its linked reminders. */
  update(
    userId: number,
    id: number,
    fields: { title?: string; categoryId?: number | null; dueDate?: string | null; linkId?: number | null },
  ): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE todos SET title = ?, category_id = ?, due_date = ?, link_id = ? WHERE id = ? AND user_id = ?').run(
      fields.title ?? current.title,
      fields.categoryId === undefined ? current.category_id : fields.categoryId,
      fields.dueDate === undefined ? current.due_date : fields.dueDate,
      fields.linkId === undefined ? current.link_id : fields.linkId,
      id,
      userId,
    );
  },

  /** A routine's Ejercicios fields (kind, place, notes) - only those given change; kind null = back to a plain routine. */
  setWorkout(userId: number, id: number, fields: { kind?: WorkoutKind | null; place?: string | null; notes?: string | null }): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE todos SET workout_kind = ?, place = ?, notes = ? WHERE id = ? AND user_id = ?').run(
      fields.kind === undefined ? current.workout_kind : fields.kind,
      fields.place === undefined ? current.place : fields.place,
      fields.notes === undefined ? current.notes : fields.notes,
      id,
      userId,
    );
  },

  complete(userId: number, id: number): void {
    db.prepare("UPDATE todos SET status = 'done', completed_at = ? WHERE id = ? AND user_id = ?").run(
      nowLocal(),
      id,
      userId,
    );
  },

  setStatus(userId: number, id: number, status: TodoStatus): void {
    db.prepare('UPDATE todos SET status = ?, completed_at = NULL WHERE id = ? AND user_id = ?').run(
      status,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, userId);
  },

  /** Case-insensitive search by title, optionally scoped. */
  findByTitle(userId: number, query: string, scope?: TodoScope): Todo[] {
    if (scope) {
      return db
        .prepare('SELECT * FROM todos WHERE user_id = ? AND scope = ? AND title LIKE ? COLLATE NOCASE')
        .all(userId, scope, `%${query}%`) as Todo[];
    }
    return db
      .prepare('SELECT * FROM todos WHERE user_id = ? AND title LIKE ? COLLATE NOCASE')
      .all(userId, `%${query}%`) as Todo[];
  },
};
