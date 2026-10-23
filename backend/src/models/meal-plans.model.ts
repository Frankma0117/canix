import { db } from '../database/connection.js';
import type { MealPlan, MealSlot } from '../entities/index.js';

export const mealPlansModel = {
  listRange(userId: number, fromDate: string, toDate: string): MealPlan[] {
    return db
      .prepare('SELECT * FROM meal_plans WHERE user_id = ? AND plan_date BETWEEN ? AND ? ORDER BY plan_date, meal_slot')
      .all(userId, fromDate, toDate) as MealPlan[];
  },

  getById(userId: number, id: number): MealPlan | undefined {
    return db.prepare('SELECT * FROM meal_plans WHERE id = ? AND user_id = ?').get(id, userId) as MealPlan | undefined;
  },

  create(
    userId: number,
    fields: { planDate: string; mealSlot: MealSlot; title: string; notes: string | null; mealTime?: string | null; prepMinutes?: number | null },
  ): number {
    const info = db
      .prepare('INSERT INTO meal_plans (user_id, plan_date, meal_slot, title, notes, meal_time, prep_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, fields.planDate, fields.mealSlot, fields.title, fields.notes, fields.mealTime ?? null, fields.prepMinutes ?? null);
    return Number(info.lastInsertRowid);
  },

  /** Partial update for a meal plan's editable fields (undefined = unchanged). */
  update(
    userId: number,
    id: number,
    fields: { planDate?: string; mealSlot?: MealSlot; title?: string; notes?: string | null; mealTime?: string | null; prepMinutes?: number | null },
  ): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE meal_plans SET plan_date = ?, meal_slot = ?, title = ?, notes = ?, meal_time = ?, prep_minutes = ? WHERE id = ? AND user_id = ?').run(
      fields.planDate ?? current.plan_date,
      fields.mealSlot ?? current.meal_slot,
      fields.title ?? current.title,
      fields.notes === undefined ? current.notes : fields.notes,
      fields.mealTime === undefined ? current.meal_time : fields.mealTime,
      fields.prepMinutes === undefined ? current.prep_minutes : fields.prepMinutes,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM meal_plans WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
