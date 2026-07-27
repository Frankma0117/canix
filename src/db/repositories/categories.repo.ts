import { db } from '../pool.js';
import type { Category } from '../../types/index.js';

export const categoriesRepo = {
  listAll(userId: number): Category[] {
    return db
      .prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(userId) as Category[];
  },

  getById(userId: number, id: number): Category | undefined {
    return db
      .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
      .get(id, userId) as Category | undefined;
  },

  getByName(userId: number, name: string): Category | undefined {
    return db
      .prepare('SELECT * FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE')
      .get(userId, name) as Category | undefined;
  },

  create(userId: number, name: string, description: string | null = null): number {
    const info = db
      .prepare('INSERT INTO categories (user_id, name, description) VALUES (?, ?, ?)')
      .run(userId, name.trim(), description);
    return Number(info.lastInsertRowid);
  },

  /** Finds a category by (case-insensitive) name, creating it if missing. */
  findOrCreate(userId: number, name: string, description: string | null = null): Category {
    const existing = this.getByName(userId, name);
    if (existing) return existing;
    const id = this.create(userId, name, description);
    return this.getById(userId, id)!;
  },

  update(userId: number, id: number, fields: { name?: string; description?: string | null }): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ? AND user_id = ?').run(
      fields.name ?? current.name,
      fields.description === undefined ? current.description : fields.description,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
