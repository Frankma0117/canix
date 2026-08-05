import { db } from '../pool.js';
import type { Exercise } from '../../types/index.js';

export const exercisesRepo = {
  listByRoutine(userId: number, todoId: number): Exercise[] {
    return db
      .prepare('SELECT * FROM exercises WHERE user_id = ? AND todo_id = ? ORDER BY order_index, id')
      .all(userId, todoId) as Exercise[];
  },

  getById(userId: number, id: number): Exercise | undefined {
    return db.prepare('SELECT * FROM exercises WHERE id = ? AND user_id = ?').get(id, userId) as Exercise | undefined;
  },

  create(
    userId: number,
    fields: {
      todoId: number;
      name: string;
      sets: number | null;
      reps: number | null;
      seconds: number | null;
      weightKg: number | null;
    },
  ): number {
    const nextOrder = (
      db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM exercises WHERE todo_id = ?').get(fields.todoId) as {
        n: number;
      }
    ).n;
    const info = db
      .prepare(
        `INSERT INTO exercises (user_id, todo_id, name, sets, reps, seconds, weight_kg, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, fields.todoId, fields.name, fields.sets, fields.reps, fields.seconds, fields.weightKg, nextOrder);
    return Number(info.lastInsertRowid);
  },

  update(
    userId: number,
    id: number,
    fields: { name?: string; sets?: number | null; reps?: number | null; seconds?: number | null; weightKg?: number | null },
  ): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE exercises SET name = ?, sets = ?, reps = ?, seconds = ?, weight_kg = ? WHERE id = ? AND user_id = ?').run(
      fields.name ?? current.name,
      fields.sets === undefined ? current.sets : fields.sets,
      fields.reps === undefined ? current.reps : fields.reps,
      fields.seconds === undefined ? current.seconds : fields.seconds,
      fields.weightKg === undefined ? current.weight_kg : fields.weightKg,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM exercises WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
