import type { Express } from 'express';
import { notesModel } from '../../models/notes.model.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, ownCategoryId, userId, str } from '../http-helpers.js';

/** Notes. */
export function registerNoteRoutes(app: Express): void {
  app.use('/api/notes', requirePermission('notes.manage'));
  app.get(
    '/api/notes',
    h((req, res) => {
      const q = str(req.query.q, 100);
      res.json(q ? notesModel.search(userId(req), q) : notesModel.listByCategory(userId(req)));
    }),
  );
  app.post(
    '/api/notes',
    h((req, res) => {
      const content = str(req.body?.content, 5000);
      if (!content) return void res.status(400).json({ error: 'La nota no puede estar vacía.' });
      res.status(201).json({ id: notesModel.create(userId(req), { content, title: str(req.body?.title, 120) ?? null, categoryId: ownCategoryId(req, req.body?.category_id) ?? null }) });
    }),
  );
  app.put(
    '/api/notes/:id',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!notesModel.getById(userId(req), id)) return void res.status(404).json({ error: 'No existe esa nota.' });
      notesModel.update(userId(req), id, {
        content: str(req.body?.content, 5000),
        title: req.body?.title === undefined ? undefined : (str(req.body.title, 120) ?? null),
        categoryId: ownCategoryId(req, req.body?.category_id),
      });
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/notes/:id',
    h((req, res) => {
      notesModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
