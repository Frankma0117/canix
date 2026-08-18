import { db } from '../pool.js';
import type { Note } from '../../types/index.js';

export const notesRepo = {
  listByCategory(userId: number, categoryId?: number): Note[] {
    if (categoryId === undefined) {
      return db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Note[];
    }
    return db
      .prepare('SELECT * FROM notes WHERE user_id = ? AND category_id = ? ORDER BY created_at DESC')
      .all(userId, categoryId) as Note[];
  },

  getById(userId: number, id: number): Note | undefined {
    return db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as Note | undefined;
  },

  /** Case-insensitive search across title/content, optionally scoped to a category. */
  search(userId: number, query: string, categoryId?: number): Note[] {
    const like = `%${query}%`;
    if (categoryId === undefined) {
      return db
        .prepare(
          `SELECT * FROM notes WHERE user_id = ? AND
           (title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)
           ORDER BY created_at DESC`,
        )
        .all(userId, like, like) as Note[];
    }
    return db
      .prepare(
        `SELECT * FROM notes WHERE user_id = ? AND category_id = ? AND
         (title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)
         ORDER BY created_at DESC`,
      )
      .all(userId, categoryId, like, like) as Note[];
  },

  create(userId: number, fields: { content: string; categoryId: number | null; title?: string | null }): number {
    const info = db
      .prepare('INSERT INTO notes (user_id, category_id, title, content) VALUES (?, ?, ?, ?)')
      .run(userId, fields.categoryId, fields.title ?? null, fields.content);
    return Number(info.lastInsertRowid);
  },

  /** Partial update for a note's editable fields (content/title/category). */
  update(userId: number, id: number, fields: { content?: string; title?: string | null; categoryId?: number | null }): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare(
      `UPDATE notes SET content = ?, title = ?, category_id = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(
      fields.content ?? current.content,
      fields.title === undefined ? current.title : fields.title,
      fields.categoryId === undefined ? current.category_id : fields.categoryId,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
