import { listKindOf, normalizeListKind } from '../util/list-kinds.js';
import type { Express } from 'express';
import { notesRepo } from '../db/repositories/notes.repo.js';
import { mealPlansRepo } from '../db/repositories/meal-plans.repo.js';
import { recipesRepo } from '../db/repositories/recipes.repo.js';
import { checklistsRepo, checklistItemsRepo } from '../db/repositories/checklists.repo.js';
import { garmentsRepo } from '../db/repositories/garments.repo.js';
import { spacesStorageService } from '../fashion/storage/spaces-storage.service.js';
import { addDays, todayLocal } from '../util/datetime.js';
import { openQuestions, reviewStatus, applyUserFields, answerQuestion, skipQuestion, queueReclassification, FIELD_LABELS, MAIN_QUESTION_FIELDS } from '../fashion/review.js';
import type { GarmentQuestion } from '../fashion/review.js';
import { FIELD_POOLS, LIST_POOLS } from '../fashion/vision/llm-vision.service.js';
import { wardrobeUpkeep } from '../fashion/upkeep.js';
import { CATEGORIES_BY_TYPE, GARMENT_TYPES, GARMENT_TYPE_LABELS, SIZES, CONDITIONS, typeForCategory } from '../fashion/taxonomy.js';
import type { Garment } from '../types/index.js';
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
    h((req, res) => res.json(checklistsRepo.list(userId(req)).map((l) => ({ ...l, kind: listKindOf(l), items: checklistItemsRepo.list(l.id) })))),
  );
  app.post(
    '/api/lists',
    h((req, res) => {
      const name = str(req.body?.name, 120);
      if (!name) return void res.status(400).json({ error: 'La lista necesita un nombre.' });
      res.status(201).json({ id: checklistsRepo.create(userId(req), name, normalizeListKind(req.body?.kind)) });
    }),
  );
  app.put(
    '/api/lists/:id',
    h((req, res) => {
      const list = checklistsRepo.getById(userId(req), Number(req.params.id));
      if (!list) return void res.status(404).json({ error: 'No existe esa lista.' });
      const name = str(req.body?.name, 120);
      const kind = normalizeListKind(req.body?.kind);
      if (req.body?.kind !== undefined && !kind) return void res.status(400).json({ error: 'Ese tipo de lista no existe.' });
      if (name) checklistsRepo.rename(userId(req), list.id, name);
      if (kind) checklistsRepo.setKind(userId(req), list.id, kind);
      res.json({ ok: true });
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
  app.use('/api/garment-questions', requirePermission('fashion.use'));
  app.get(
    '/api/garments',
    h((req, res) => {
      const limit = Math.min(Math.max(int(req.query.limit) ?? 60, 1), 200);
      const offset = Math.max(int(req.query.offset) ?? 0, 0);
      const type = str(req.query.type);
      const { rows, total } = garmentsRepo.list(userId(req), type ? { type } : {}, { limit, offset });
      const asking = new Set(openQuestions(userId(req)).filter((q) => MAIN_QUESTION_FIELDS.includes(q.field)).map((q) => q.garment_id));
      res.json({ total, rows: rows.map((g) => ({ ...garmentCard(g), needs_review: asking.has(g.id) })) });
    }),
  );
  // What the selects of the wardrobe page offer: every field with its allowed values, in Spanish.
  app.get(
    '/api/garments/taxonomy',
    h((_req, res) => res.json(wardrobeTaxonomy())),
  );
  // "Por revisar": the garments the classifier has questions about, each with its questions.
  app.get(
    '/api/garments/review',
    h((req, res) => {
      const questions = openQuestions(userId(req));
      const byGarment = new Map<number, typeof questions>();
      for (const q of questions) byGarment.set(q.garment_id, [...(byGarment.get(q.garment_id) ?? []), q]);
      const garments = [...byGarment.entries()].flatMap(([garmentId, qs]) => {
        const g = garmentsRepo.getById(userId(req), garmentId);
        return g ? [{ ...garmentDetail(g), questions: qs.map(questionView) }] : [];
      });
      res.json({ status: reviewStatus(userId(req)), garments });
    }),
  );
  app.get(
    '/api/garments/:id',
    h((req, res) => {
      const g = garmentsRepo.getById(userId(req), Number(req.params.id));
      if (!g) return void res.status(404).json({ error: 'No existe esa prenda.' });
      res.json({ ...garmentDetail(g), questions: openQuestions(userId(req), g.id).map(questionView) });
    }),
  );
  // Editing a garment by hand: whatever is set here is the person's word, kept over any re-analysis.
  app.put(
    '/api/garments/:id',
    h((req, res) => {
      const result = applyUserFields(userId(req), Number(req.params.id), (req.body?.fields ?? {}) as Record<string, unknown>);
      if ('error' in result) return void res.status(400).json(result);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/garments/reclassify',
    h((req, res) => {
      const queued = queueReclassification(userId(req));
      void wardrobeUpkeep();
      res.json({ ok: true, queued });
    }),
  );
  app.post(
    '/api/garment-questions/:id/answer',
    h(async (req, res) => {
      const result = await answerQuestion(userId(req), Number(req.params.id), req.body?.value);
      if ('error' in result) return void res.status(400).json(result);
      res.json(result);
    }),
  );
  app.post(
    '/api/garment-questions/:id/skip',
    h((req, res) => {
      skipQuestion(userId(req), Number(req.params.id));
      res.json({ ok: true });
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

// ---------- Wardrobe: how garments and their questions are shown to the portal ----------

const humanize = (value: string) => {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function optionLabel(field: string, value: string): string {
  if (field === 'category') {
    const type = typeForCategory(value);
    return (type && CATEGORIES_BY_TYPE[type].find((c) => c.value === value)?.label) ?? humanize(value);
  }
  if (field === 'is_garment') return value === 'borrar' ? 'No es una prenda: bórrala' : 'Sí es una prenda: déjala';
  return humanize(value);
}

function jsonList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function jsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function garmentCard(g: Garment) {
  return {
    id: g.id,
    image_url: g.thumbnail_url ?? g.image_url,
    type: g.type,
    category: g.category,
    category_label: optionLabel('category', g.category),
    color: g.color,
    short_description: g.short_description,
    favorite: !!g.favorite,
  };
}

function garmentDetail(g: Garment) {
  const meta = jsonObject(g.analysis_confidence) as Record<string, { byUser?: boolean }>;
  const seen = jsonObject(g.ai_metadata).descripcion;
  return {
    ...garmentCard(g),
    full_image_url: g.image_url,
    long_description: g.long_description,
    /** What the classifier said it saw in the photo, in its own words. */
    seen: typeof seen === 'string' ? seen : null,
    classified_by: g.analysis_model?.startsWith('fal:') ? 'vision' : g.analysis_model ? 'local' : null,
    by_user: Object.entries(meta).filter(([, m]) => m?.byUser).map(([field]) => field),
    fields: {
      category: g.category,
      subcategory: g.subcategory,
      color: g.color,
      secondaryColors: jsonList(g.secondary_colors),
      pattern: g.pattern,
      material: g.material,
      fit: g.fit,
      style: jsonList(g.style),
      formality: g.formality,
      occasions: jsonList(g.occasions),
      season: jsonList(g.season),
      weather: jsonList(g.weather),
      warmth: g.warmth,
      waterResistance: g.water_resistance,
      neckline: g.neckline,
      sleeves: g.sleeves,
      length: g.length,
      closure: g.closure,
      pockets: g.pockets,
      gender: g.gender,
      brand: g.brand,
      size: g.size,
      condition: g.condition,
      notes: g.notes,
    },
  };
}

function questionView(q: GarmentQuestion) {
  return {
    id: q.id,
    field: q.field,
    label: q.field === 'is_garment' ? 'Foto' : FIELD_LABELS[q.field] ?? q.field,
    question: q.question,
    options: jsonList(q.options).map((value) => ({ value, label: optionLabel(q.field, value) })),
    suggested: q.suggested,
    many: !!LIST_POOLS[q.field],
    main: MAIN_QUESTION_FIELDS.includes(q.field),
  };
}

/** Which kinds of garment a field makes sense for (none listed = all). */
const FIELD_TYPES: Record<string, string[]> = {
  neckline: ['TOP', 'OUTERWEAR', 'FULL_BODY'],
  sleeves: ['TOP', 'OUTERWEAR', 'FULL_BODY'],
  length: ['BOTTOM', 'FULL_BODY', 'OUTERWEAR'],
  closure: ['TOP', 'OUTERWEAR', 'BOTTOM', 'FULL_BODY', 'FOOTWEAR'],
  pockets: ['TOP', 'OUTERWEAR', 'BOTTOM', 'FULL_BODY'],
};
const FIELD_ORDER = [
  'subcategory', 'color', 'secondaryColors', 'pattern', 'material', 'fit', 'style', 'formality', 'occasions', 'season', 'weather',
  'warmth', 'waterResistance', 'neckline', 'sleeves', 'length', 'closure', 'pockets', 'gender', 'brand', 'size', 'condition', 'notes',
];

function wardrobeTaxonomy() {
  const pools: Record<string, readonly string[]> = { ...FIELD_POOLS, size: SIZES, condition: CONDITIONS };
  return {
    types: GARMENT_TYPES.map((type) => ({ value: type, label: GARMENT_TYPE_LABELS[type], categories: CATEGORIES_BY_TYPE[type] })),
    fields: FIELD_ORDER.map((key) => {
      const pool = pools[key] ?? LIST_POOLS[key];
      return {
        key,
        label: FIELD_LABELS[key] ?? key,
        kind: LIST_POOLS[key] ? 'many' : pool ? 'one' : 'text',
        options: (pool ?? []).map((value) => ({ value, label: key === 'size' ? value.toUpperCase() : humanize(value) })),
        only_types: FIELD_TYPES[key] ?? null,
      };
    }),
  };
}
