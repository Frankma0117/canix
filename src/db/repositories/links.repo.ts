import { db } from '../pool.js';
import { nowLocal } from '../../util/datetime.js';
import type { Link } from '../../types/index.js';

export const linksRepo = {
  listByCategory(userId: number, categoryId?: number): Link[] {
    if (categoryId === undefined) {
      return db
        .prepare('SELECT * FROM links WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as Link[];
    }
    return db
      .prepare('SELECT * FROM links WHERE user_id = ? AND category_id = ? ORDER BY created_at DESC')
      .all(userId, categoryId) as Link[];
  },

  getById(userId: number, id: number): Link | undefined {
    return db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(id, userId) as Link | undefined;
  },

  /** Case-insensitive search across url/title/description, optionally scoped to a category. */
  search(userId: number, query: string, categoryId?: number): Link[] {
    const like = `%${query}%`;
    if (categoryId === undefined) {
      return db
        .prepare(
          `SELECT * FROM links WHERE user_id = ? AND
           (url LIKE ? COLLATE NOCASE OR title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)
           ORDER BY created_at DESC`,
        )
        .all(userId, like, like, like) as Link[];
    }
    return db
      .prepare(
        `SELECT * FROM links WHERE user_id = ? AND category_id = ? AND
         (url LIKE ? COLLATE NOCASE OR title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)
         ORDER BY created_at DESC`,
      )
      .all(userId, categoryId, like, like, like) as Link[];
  },

  create(
    userId: number,
    fields: { url: string; categoryId: number | null; title?: string | null; description?: string | null },
  ): number {
    const info = db
      .prepare('INSERT INTO links (user_id, category_id, url, title, description) VALUES (?, ?, ?, ?, ?)')
      .run(userId, fields.categoryId, fields.url, fields.title ?? null, fields.description ?? null);
    return Number(info.lastInsertRowid);
  },

  /** Picks a random link from a category, favoring ones used least recently. */
  pickRandom(userId: number, categoryId: number): Link | undefined {
    return db
      .prepare(
        `SELECT * FROM links WHERE user_id = ? AND category_id = ?
         ORDER BY (last_used_at IS NOT NULL), RANDOM() LIMIT 1`,
      )
      .get(userId, categoryId) as Link | undefined;
  },

  markUsed(userId: number, id: number): void {
    db.prepare(
      'UPDATE links SET used_count = used_count + 1, last_used_at = ? WHERE id = ? AND user_id = ?',
    ).run(nowLocal(), id, userId);
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
