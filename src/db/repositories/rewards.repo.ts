import { db } from '../pool.js';
import { todayLocal } from '../../util/datetime.js';
import type { RewardPunishment, RewardPunishmentType } from '../../types/index.js';

export const rewardsRepo = {
  listAll(userId: number, type?: RewardPunishmentType): RewardPunishment[] {
    if (!type) {
      return db
        .prepare('SELECT * FROM rewards_punishments WHERE user_id = ? ORDER BY date DESC, id DESC')
        .all(userId) as RewardPunishment[];
    }
    return db
      .prepare('SELECT * FROM rewards_punishments WHERE user_id = ? AND type = ? ORDER BY date DESC, id DESC')
      .all(userId, type) as RewardPunishment[];
  },

  listByTodo(userId: number, todoId: number): RewardPunishment[] {
    return db
      .prepare('SELECT * FROM rewards_punishments WHERE user_id = ? AND todo_id = ? ORDER BY date DESC, id DESC')
      .all(userId, todoId) as RewardPunishment[];
  },

  getById(userId: number, id: number): RewardPunishment | undefined {
    return db
      .prepare('SELECT * FROM rewards_punishments WHERE id = ? AND user_id = ?')
      .get(id, userId) as RewardPunishment | undefined;
  },

  create(
    userId: number,
    fields: {
      todoId: number | null;
      type: RewardPunishmentType;
      description: string;
      note: string | null;
      date?: string;
    },
  ): number {
    const info = db
      .prepare(
        `INSERT INTO rewards_punishments (user_id, todo_id, type, description, note, date)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, fields.todoId, fields.type, fields.description, fields.note, fields.date ?? todayLocal());
    return Number(info.lastInsertRowid);
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM rewards_punishments WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
