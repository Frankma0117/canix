import { db } from '../pool.js';
import type { Category } from '../../types/index.js';

export const categoriesRepo = {
  listAll(): Category[] {
    return db.prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE').all() as Category[];
  },

  getById(id: number): Category | undefined {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined;
  },

  getByName(name: string): Category | undefined {
    return db
      .prepare('SELECT * FROM categories WHERE name = ? COLLATE NOCASE')
      .get(name) as Category | undefined;
  },

  create(name: string, description: string | null = null): number {
    const info = db
      .prepare('INSERT INTO categories (name, description) VALUES (?, ?)')
      .run(name.trim(), description);
    return Number(info.lastInsertRowid);
  },

  /** Finds a category by (case-insensitive) name, creating it if missing. */
  findOrCreate(name: string, description: string | null = null): Category {
    const existing = this.getByName(name);
    if (existing) return existing;
    const id = this.create(name, description);
    return this.getById(id)!;
  },

  update(id: number, fields: { name?: string; description?: string | null }): void {
    const current = this.getById(id);
    if (!current) return;
    db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(
      fields.name ?? current.name,
      fields.description === undefined ? current.description : fields.description,
      id,
    );
  },

  remove(id: number): void {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },
};
