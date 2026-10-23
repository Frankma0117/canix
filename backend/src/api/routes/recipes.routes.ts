import type { Express } from 'express';
import { recipesModel } from '../../models/recipes.model.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, userId, str } from '../http-helpers.js';

/** Saved recipes. */
export function registerRecipeRoutes(app: Express): void {
  app.use('/api/recipes', requirePermission('recipes.manage'));
  app.get('/api/recipes', h((req, res) => res.json(recipesModel.listAll(userId(req)))));
  app.post(
    '/api/recipes',
    h((req, res) => {
      const title = str(req.body?.title, 200);
      if (!title) return void res.status(400).json({ error: 'La receta necesita un título.' });
      res.status(201).json({
        id: recipesModel.create(userId(req), {
          title,
          ingredients: str(req.body?.ingredients, 5000) ?? '',
          instructions: str(req.body?.instructions, 10000) ?? '',
          categoryId: null,
        }),
      });
    }),
  );
  app.delete(
    '/api/recipes/:id',
    h((req, res) => {
      recipesModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
