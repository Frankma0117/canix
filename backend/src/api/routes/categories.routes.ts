import { type Express } from 'express';
import { categoriesModel } from '../../models/categories.model.js';
import { h, userId } from '../http-helpers.js';

/** Categories, shared by links, notes, reminders, to-dos and recipes. */
export function registerCategoryRoutes(app: Express): void {
  app.get(
    '/api/categories',
    h((req, res) => {
      // Shared by every module: each one comes with what it groups (see categoriesModel.usage).
      const usage = categoriesModel.usage(userId(req));
      const empty = { links: 0, notes: 0, reminders: 0, todos: 0, recipes: 0 };
      res.json(categoriesModel.listAll(userId(req)).map((c) => ({ ...c, usage: usage.get(c.id) ?? empty })));
    }),
  );
  app.post(
    '/api/categories',
    h((req, res) => {
      const { name, description } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name requerido' });
      const id = categoriesModel.create(userId(req), name, description || null);
      res.json({ id });
    }),
  );
  app.put(
    '/api/categories/:id',
    h((req, res) => {
      categoriesModel.update(userId(req), Number(req.params.id), req.body ?? {});
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/categories/:id',
    h((req, res) => {
      categoriesModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
