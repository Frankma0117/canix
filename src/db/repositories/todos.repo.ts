import { db } from '../pool.js';
import { nowLocal } from '../../util/datetime.js';
import type { RecurrenceFreq, Todo, TodoScope, TodoStatus } from '../../types/index.js';

export const todosRepo = {
  list(filters: { scope?: TodoScope; status?: TodoStatus; categoryId?: number } = {}): Todo[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
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
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(`SELECT * FROM todos ${where} ORDER BY due_date IS NULL, due_date, created_at`)
      .all(...params) as Todo[];
  },

  getById(id: number): Todo | undefined {
    return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined;
  },

  create(fields: {
    title: string;
    categoryId: number | null;
    scope: TodoScope;
    dueDate: string | null;
    recurrenceFreq?: RecurrenceFreq | null;
  }): number {
    const info = db
      .prepare(
        `INSERT INTO todos (title, category_id, scope, due_date, recurrence_freq)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        fields.title,
        fields.categoryId,
        fields.scope,
        fields.dueDate,
        fields.recurrenceFreq ?? null,
      );
    return Number(info.lastInsertRowid);
  },

  complete(id: number): void {
    db.prepare("UPDATE todos SET status = 'done', completed_at = ? WHERE id = ?").run(
      nowLocal(),
      id,
    );
  },

  setStatus(id: number, status: TodoStatus): void {
    db.prepare('UPDATE todos SET status = ?, completed_at = NULL WHERE id = ?').run(status, id);
  },

  remove(id: number): void {
    db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  },

  /** Case-insensitive search by title, optionally scoped. */
  findByTitle(query: string, scope?: TodoScope): Todo[] {
    if (scope) {
      return db
        .prepare('SELECT * FROM todos WHERE scope = ? AND title LIKE ? COLLATE NOCASE')
        .all(scope, `%${query}%`) as Todo[];
    }
    return db
      .prepare('SELECT * FROM todos WHERE title LIKE ? COLLATE NOCASE')
      .all(`%${query}%`) as Todo[];
  },
};
