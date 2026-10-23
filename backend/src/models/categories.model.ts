import { db } from '../database/connection.js';
import type { Category } from '../entities/index.js';

export interface CategoryUsage {
  links: number;
  notes: number;
  reminders: number;
  todos: number;
  recipes: number;
}

export const categoriesModel = {
  listAll(userId: number): Category[] {
    return db
      .prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(userId) as Category[];
  },

  /** What each category groups, across every module that can be filed under one (categories are
   *  shared: one "Salud" holds links, notes, reminders, tasks and recipes alike). */
  usage(userId: number): Map<number, CategoryUsage> {
    const out = new Map<number, CategoryUsage>();
    const empty = (): CategoryUsage => ({ links: 0, notes: 0, reminders: 0, todos: 0, recipes: 0 });
    const queries: [keyof CategoryUsage, string][] = [
      ['links', 'SELECT category_id AS id, COUNT(*) AS n FROM links WHERE user_id = ? AND category_id IS NOT NULL GROUP BY category_id'],
      ['notes', 'SELECT category_id AS id, COUNT(*) AS n FROM notes WHERE user_id = ? AND category_id IS NOT NULL GROUP BY category_id'],
      ['reminders', "SELECT category_id AS id, COUNT(*) AS n FROM reminders WHERE user_id = ? AND category_id IS NOT NULL AND status = 'pending' GROUP BY category_id"],
      ['todos', "SELECT category_id AS id, COUNT(*) AS n FROM todos WHERE user_id = ? AND category_id IS NOT NULL AND status = 'pending' GROUP BY category_id"],
      ['recipes', 'SELECT category_id AS id, COUNT(*) AS n FROM recipes WHERE user_id = ? AND category_id IS NOT NULL GROUP BY category_id'],
    ];
    for (const [key, sql] of queries) {
      for (const row of db.prepare(sql).all(userId) as { id: number; n: number }[]) {
        const u = out.get(row.id) ?? empty();
        u[key] = row.n;
        out.set(row.id, u);
      }
    }
    return out;
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
