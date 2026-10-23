import type { Express } from 'express';
import { garmentsModel } from '../../models/garments.model.js';
import { spacesStorageService } from '../../services/fashion/storage/spaces-storage.service.js';
import { openQuestions, reviewStatus, applyUserFields, answerQuestion, skipQuestion, queueReclassification, FIELD_LABELS, MAIN_QUESTION_FIELDS } from '../../services/fashion/review.js';
import type { GarmentQuestion } from '../../services/fashion/review.js';
import { FIELD_POOLS, LIST_POOLS } from '../../services/fashion/vision/llm-vision.service.js';
import { wardrobeUpkeep } from '../../services/fashion/upkeep.js';
import { CATEGORIES_BY_TYPE, GARMENT_TYPES, GARMENT_TYPE_LABELS, SIZES, CONDITIONS, typeForCategory } from '../../services/fashion/taxonomy.js';
import type { Garment } from '../../entities/index.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, userId, str, int } from '../http-helpers.js';

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

/** Fashion Mode wardrobe: browse, edit, favorite and delete garments, answer the vision model's questions. Adding garments stays on WhatsApp. */
export function registerWardrobeRoutes(app: Express): void {
  app.use('/api/garments', requirePermission('fashion.use'));
  app.use('/api/garment-questions', requirePermission('fashion.use'));
  app.get(
    '/api/garments',
    h((req, res) => {
      const limit = Math.min(Math.max(int(req.query.limit) ?? 60, 1), 200);
      const offset = Math.max(int(req.query.offset) ?? 0, 0);
      const type = str(req.query.type);
      const { rows, total } = garmentsModel.list(userId(req), type ? { type } : {}, { limit, offset });
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
        const g = garmentsModel.getById(userId(req), garmentId);
        return g ? [{ ...garmentDetail(g), questions: qs.map(questionView) }] : [];
      });
      res.json({ status: reviewStatus(userId(req)), garments });
    }),
  );
  app.get(
    '/api/garments/:id',
    h((req, res) => {
      const g = garmentsModel.getById(userId(req), Number(req.params.id));
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
      garmentsModel.setFavorite(userId(req), Number(req.params.id), Boolean(req.body?.favorite));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/garments/:id',
    h(async (req, res) => {
      const removed = garmentsModel.remove(userId(req), Number(req.params.id));
      if (!removed) return void res.status(404).json({ error: 'No existe esa prenda.' });
      await spacesStorageService.delete([removed.storageKey, ...(removed.thumbnailKey ? [removed.thumbnailKey] : [])]).catch((err) => {
        console.error('[API] Could not delete the garment image:', (err as Error).message);
      });
      res.json({ ok: true });
    }),
  );
}
