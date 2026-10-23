import { type Express } from 'express';
import { rewardsModel } from '../../models/rewards.model.js';
import { todayLocal } from '../../shared/utils/datetime.js';
import { h, userId } from '../http-helpers.js';
import type { RewardPunishmentType } from '../../entities/index.js';
import { todosModel } from '../../models/todos.model.js';

/** Rewards and punishments tied to routines. */
export function registerRewardRoutes(app: Express): void {
  app.get(
    '/api/rewards',
    h((req, res) => {
      const type = req.query.type as RewardPunishmentType | undefined;
      const todoId = req.query.todoId ? Number(req.query.todoId) : undefined;
      const uid = userId(req);
      res.json(todoId ? rewardsModel.listByTodo(uid, todoId) : rewardsModel.listAll(uid, type));
    }),
  );
  app.post(
    '/api/rewards',
    h((req, res) => {
      const { type, description, todo_id, note, date } = req.body ?? {};
      if (type !== 'reward' && type !== 'punishment') return res.status(400).json({ error: 'type debe ser reward o punishment' });
      if (!description) return res.status(400).json({ error: 'description requerida' });
      const id = rewardsModel.create(userId(req), {
        type,
        description,
        // only one of the person's own routines can be linked
        todoId: todo_id != null && todosModel.getById(userId(req), Number(todo_id)) ? Number(todo_id) : null,
        note: note || null,
        date: date || todayLocal(),
      });
      res.json({ id });
    }),
  );
  app.delete(
    '/api/rewards/:id',
    h((req, res) => {
      rewardsModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
