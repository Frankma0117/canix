import type { Express } from 'express';
import { notesRepo } from '../db/repositories/notes.repo.js';
import { mealPlansRepo } from '../db/repositories/meal-plans.repo.js';
import { recipesRepo } from '../db/repositories/recipes.repo.js';
import { checklistsRepo, checklistItemsRepo } from '../db/repositories/checklists.repo.js';
import { garmentsRepo } from '../db/repositories/garments.repo.js';
import { spacesStorageService } from '../fashion/storage/spaces-storage.service.js';
import { addDays, todayLocal } from '../util/datetime.js';
import { requirePermission } from './auth.js';
import { h, userId, str, int } from './http-helpers.js';
import type { MealSlot } from '../types/index.js';

const MEAL_SLOTS: MealSlot[] = ['desayuno', 'almuerzo', 'cena', 'onces'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Web routes for modules the portal didn't cover before: notes, meals, recipes, lists, wardrobe. */
export function registerModuleRoutes(app: Express): void {
  // ---------- Notes ----------
  app.use('/api/notes', requirePermission('notes.manage'));
  app.get(
    '/api/notes',
    h((req, res) => {
      const q = str(req.query.q, 100);
      res.json(q ? notesRepo.search(userId(req), q) : notesRepo.listByCategory(userId(req)));
    }),
  );
  app.post(
    '/api/notes',
    h((req, res) => {
      const content = str(req.body?.content, 5000);
      if (!content) return void res.status(400).json({ error: 'La nota no puede estar vacía.' });
      res.status(201).json({ id: notesRepo.create(userId(req), { content, title: str(req.body?.title, 120) ?? null, categoryId: int(req.body?.category_id) ?? null }) });
    }),
  );
  app.put(
    '/api/notes/:id',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!notesRepo.getById(userId(req), id)) return void res.status(404).json({ error: 'No existe esa nota.' });
      notesRepo.update(userId(req), id, {
        content: str(req.body?.content, 5000),
        title: req.body?.title === undefined ? undefined : (str(req.body.title, 120) ?? null),
      });
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/notes/:id',
    h((req, res) => {
      notesRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Meal plan ----------
  app.use('/api/meals', requirePermission('meals.manage'));
  app.get(
    '/api/meals',
    h((req, res) => {
      const from = DATE_RE.test(String(req.query.from ?? '')) ? String(req.query.from) : todayLocal();
      const to = DATE_RE.test(String(req.query.to ?? '')) ? String(req.query.to) : addDays(from, 13).slice(0, 10);
      res.json(mealPlansRepo.listRange(userId(req), from, to));
    }),
  );
  app.post(
    '/api/meals',
    h((req, res) => {
      const slot = String(req.body?.meal_slot ?? '') as MealSlot;
      const date = String(req.body?.plan_date ?? '');
      const title = str(req.body?.title, 200);
      if (!DATE_RE.test(date) || !MEAL_SLOTS.includes(slot) || !title) return void res.status(400).json({ error: 'Fecha, comida y plato son requeridos.' });
      res.status(201).json({ id: mealPlansRepo.create(userId(req), { planDate: date, mealSlot: slot, title, notes: str(req.body?.notes, 500) ?? null }) });
    }),
  );
  app.delete(
    '/api/meals/:id',
    h((req, res) => {
      mealPlansRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Recipes ----------
  app.use('/api/recipes', requirePermission('recipes.manage'));
  app.get('/api/recipes', h((req, res) => res.json(recipesRepo.listAll(userId(req)))));
  app.post(
    '/api/recipes',
    h((req, res) => {
      const title = str(req.body?.title, 200);
      if (!title) return void res.status(400).json({ error: 'La receta necesita un título.' });
      res.status(201).json({
        id: recipesRepo.create(userId(req), {
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
      recipesRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Checklists (part of "tareas") ----------
  app.use('/api/lists', requirePermission('todos.manage'));
  app.get(
    '/api/lists',
    h((req, res) => res.json(checklistsRepo.list(userId(req)).map((l) => ({ ...l, items: checklistItemsRepo.list(l.id) })))),
  );
  app.post(
    '/api/lists',
    h((req, res) => {
      const name = str(req.body?.name, 120);
      if (!name) return void res.status(400).json({ error: 'La lista necesita un nombre.' });
      res.status(201).json({ id: checklistsRepo.create(userId(req), name) });
    }),
  );
  app.delete(
    '/api/lists/:id',
    h((req, res) => {
      checklistsRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/lists/:id/items',
    h((req, res) => {
      const list = checklistsRepo.getById(userId(req), Number(req.params.id));
      const title = str(req.body?.title, 200);
      if (!list || !title) return void res.status(400).json({ error: 'Lista o elemento inválido.' });
      res.status(201).json({ id: checklistItemsRepo.add(userId(req), list.id, title) });
    }),
  );
  app.put(
    '/api/lists/items/:id',
    h((req, res) => {
      checklistItemsRepo.setChecked(userId(req), Number(req.params.id), Boolean(req.body?.checked));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/lists/items/:id',
    h((req, res) => {
      checklistItemsRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Wardrobe (Fashion) - browse/favorite/delete; adding garments stays on WhatsApp ----------
  app.use('/api/garments', requirePermission('fashion.use'));
  app.get(
    '/api/garments',
    h((req, res) => {
      const limit = Math.min(Math.max(int(req.query.limit) ?? 60, 1), 200);
      const offset = Math.max(int(req.query.offset) ?? 0, 0);
      const { rows, total } = garmentsRepo.list(userId(req), {}, { limit, offset });
      res.json({
        total,
        rows: rows.map((g) => ({
          id: g.id,
          image_url: g.thumbnail_url ?? g.image_url,
          type: g.type,
          category: g.category,
          color: g.color,
          short_description: g.short_description,
          favorite: !!g.favorite,
        })),
      });
    }),
  );
  app.put(
    '/api/garments/:id/favorite',
    h((req, res) => {
      garmentsRepo.setFavorite(userId(req), Number(req.params.id), Boolean(req.body?.favorite));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/garments/:id',
    h(async (req, res) => {
      const removed = garmentsRepo.remove(userId(req), Number(req.params.id));
      if (!removed) return void res.status(404).json({ error: 'No existe esa prenda.' });
      await spacesStorageService.delete([removed.storageKey, ...(removed.thumbnailKey ? [removed.thumbnailKey] : [])]).catch((err) => {
        console.error('[API] No se pudo borrar la imagen de la prenda:', (err as Error).message);
      });
      res.json({ ok: true });
    }),
  );
}
