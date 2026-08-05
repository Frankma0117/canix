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

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
