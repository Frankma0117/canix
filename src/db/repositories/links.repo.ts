import { db } from '../pool.js';
import { nowLocal } from '../../util/datetime.js';
import type { Link } from '../../types/index.js';

export const linksRepo = {
  listByCategory(categoryId?: number): Link[] {
    if (categoryId === undefined) {
      return db.prepare('SELECT * FROM links ORDER BY created_at DESC').all() as Link[];
    }
    return db
      .prepare('SELECT * FROM links WHERE category_id = ? ORDER BY created_at DESC')
      .all(categoryId) as Link[];
  },

  getById(id: number): Link | undefined {
    return db.prepare('SELECT * FROM links WHERE id = ?').get(id) as Link | undefined;
  },

  /** Case-insensitive search across url/title/description, optionally scoped to a category. */
  search(query: string, categoryId?: number): Link[] {
    const like = `%${query}%`;
    if (categoryId === undefined) {
      return db
        .prepare(
          `SELECT * FROM links WHERE url LIKE ? COLLATE NOCASE OR title LIKE ? COLLATE NOCASE
           OR description LIKE ? COLLATE NOCASE ORDER BY created_at DESC`,
        )
        .all(like, like, like) as Link[];
    }
    return db
      .prepare(
        `SELECT * FROM links WHERE category_id = ? AND
         (url LIKE ? COLLATE NOCASE OR title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)
         ORDER BY created_at DESC`,
      )
      .all(categoryId, like, like, like) as Link[];
  },

  create(fields: {
    url: string;
    categoryId: number | null;
    title?: string | null;
    description?: string | null;
  }): number {
    const info = db
      .prepare(
        'INSERT INTO links (category_id, url, title, description) VALUES (?, ?, ?, ?)',
      )
      .run(fields.categoryId, fields.url, fields.title ?? null, fields.description ?? null);
    return Number(info.lastInsertRowid);
  },

  /** Picks a random link from a category, favoring ones used least recently. */
  pickRandom(categoryId: number): Link | undefined {
    return db
      .prepare(
        `SELECT * FROM links WHERE category_id = ?
         ORDER BY (last_used_at IS NOT NULL), RANDOM() LIMIT 1`,
      )
      .get(categoryId) as Link | undefined;
  },

  markUsed(id: number): void {
    db.prepare('UPDATE links SET used_count = used_count + 1, last_used_at = ? WHERE id = ?').run(
      nowLocal(),
      id,
    );
  },

  remove(id: number): void {
    db.prepare('DELETE FROM links WHERE id = ?').run(id);
  },
};
