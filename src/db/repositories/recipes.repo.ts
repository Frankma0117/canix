import { db } from '../pool.js';
import type { Recipe } from '../../types/index.js';

export const recipesRepo = {
  listAll(userId: number): Recipe[] {
    return db.prepare('SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Recipe[];
  },

  getById(userId: number, id: number): Recipe | undefined {
    return db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId) as Recipe | undefined;
  },

  create(userId: number, fields: { title: string; ingredients: string; instructions: string; categoryId: number | null }): number {
    const info = db
      .prepare('INSERT INTO recipes (user_id, title, ingredients, instructions, category_id) VALUES (?, ?, ?, ?, ?)')
      .run(userId, fields.title, fields.ingredients, fields.instructions, fields.categoryId);
    return Number(info.lastInsertRowid);
  },

  /** Partial update for a recipe's editable fields. */
  update(
    userId: number,
    id: number,
    fields: { title?: string; ingredients?: string; instructions?: string; categoryId?: number | null },
  ): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE recipes SET title = ?, ingredients = ?, instructions = ?, category_id = ? WHERE id = ? AND user_id = ?').run(
      fields.title ?? current.title,
      fields.ingredients ?? current.ingredients,
      fields.instructions ?? current.instructions,
      fields.categoryId === undefined ? current.category_id : fields.categoryId,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
