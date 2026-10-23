import { listKindOf, normalizeListKind } from '../../shared/utils/list-kinds.js';
import type { Express } from 'express';
import { checklistsModel, checklistItemsModel } from '../../models/checklists.model.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, userId, str } from '../http-helpers.js';

/** Lists ticked off item by item (part of to-dos). */
export function registerListRoutes(app: Express): void {
  app.use('/api/lists', requirePermission('todos.manage'));
  app.get(
    '/api/lists',
    h((req, res) => res.json(checklistsModel.list(userId(req)).map((l) => ({ ...l, kind: listKindOf(l), items: checklistItemsModel.list(l.id) })))),
  );
  app.post(
    '/api/lists',
    h((req, res) => {
      const name = str(req.body?.name, 120);
      if (!name) return void res.status(400).json({ error: 'La lista necesita un nombre.' });
      res.status(201).json({ id: checklistsModel.create(userId(req), name, normalizeListKind(req.body?.kind)) });
    }),
  );
  app.put(
    '/api/lists/:id',
    h((req, res) => {
      const list = checklistsModel.getById(userId(req), Number(req.params.id));
      if (!list) return void res.status(404).json({ error: 'No existe esa lista.' });
      const name = str(req.body?.name, 120);
      const kind = normalizeListKind(req.body?.kind);
      if (req.body?.kind !== undefined && !kind) return void res.status(400).json({ error: 'Ese tipo de lista no existe.' });
      if (name) checklistsModel.rename(userId(req), list.id, name);
      if (kind) checklistsModel.setKind(userId(req), list.id, kind);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/lists/:id',
    h((req, res) => {
      checklistsModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/lists/:id/items',
    h((req, res) => {
      const list = checklistsModel.getById(userId(req), Number(req.params.id));
      const title = str(req.body?.title, 200);
      if (!list || !title) return void res.status(400).json({ error: 'Lista o elemento inválido.' });
      res.status(201).json({ id: checklistItemsModel.add(userId(req), list.id, title) });
    }),
  );
  app.put(
    '/api/lists/items/:id',
    h((req, res) => {
      checklistItemsModel.setChecked(userId(req), Number(req.params.id), Boolean(req.body?.checked));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/lists/items/:id',
    h((req, res) => {
      checklistItemsModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
