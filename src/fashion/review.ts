import { db } from '../db/pool.js';
import { env } from '../config/env.js';
import { garmentsRepo } from '../db/repositories/garments.repo.js';
import type { GarmentUpdateFields } from '../db/repositories/garments.repo.js';
import { spacesStorageService } from './storage/spaces-storage.service.js';
import { httpVisionService } from './vision/http-vision.service.js';
import { llmVision, FIELD_POOLS, LIST_POOLS } from './vision/llm-vision.service.js';
import type { GarmentDoubt, LlmGarmentAnalysis } from './vision/llm-vision.service.js';
import type { FieldMeta } from './vision/vision.service.js';
import { CATEGORIES_BY_TYPE, CONDITIONS, SIZES, typeForCategory } from './taxonomy.js';
import type { GarmentType } from './taxonomy.js';
import { buildShortDescription, buildLongDescription } from './description.js';
import { applyVisionAnalysis } from './flows/add-garment.flow.js';
import type { GarmentDraft } from './types.js';
import type { Garment } from '../types/index.js';

/**
 * Classifying a garment well, and asking when it can't be done well.
 *
 * Every garment goes through the vision LLM (vision/llm-vision.service.ts): new ones as they're
 * added, and the ones saved before it existed in the background (reclassifyPending, run from
 * upkeep.ts). Whatever it isn't sure of becomes a question in `garment_questions`, which the
 * person answers from the portal's wardrobe page; an answer (or any edit made there) is marked as
 * theirs and no later re-analysis touches it again.
 */

export interface GarmentQuestion {
  id: number;
  user_id: number;
  garment_id: number;
  field: string;
  question: string;
  options: string; // JSON array
  suggested: string | null;
  status: 'open' | 'answered' | 'skipped';
  answer: string | null;
  created_at: string;
  answered_at: string | null;
}

/** The questions that decide whether a garment can be used at all; the rest are details. */
export const MAIN_QUESTION_FIELDS = ['is_garment', 'category', 'color'];

/** Spanish names of the fields, for questions and for the portal. */
export const FIELD_LABELS: Record<string, string> = {
  type: 'Tipo',
  category: 'Prenda',
  subcategory: 'Detalle',
  color: 'Color principal',
  secondaryColors: 'Otros colores',
  pattern: 'Estampado',
  material: 'Material',
  fit: 'Ajuste',
  style: 'Estilo',
  formality: 'Formalidad',
  season: 'Temporada',
  weather: 'Clima',
  occasions: 'Ocasiones',
  warmth: 'Qué tanto abriga',
  waterResistance: 'Resistencia al agua',
  neckline: 'Cuello',
  sleeves: 'Mangas',
  length: 'Largo',
  closure: 'Cierre',
  pockets: 'Bolsillos',
  gender: 'Género',
  brand: 'Marca',
  size: 'Talla',
  condition: 'Estado',
  notes: 'Notas',
};

const FREE_TEXT_FIELDS = ['subcategory', 'brand', 'notes'] as const;
const EXTRA_POOLS: Record<string, readonly string[]> = { size: SIZES, condition: CONDITIONS };
/** Only meaningful for some kinds of garment: emptied when a re-analysis doesn't see them. */
const CONDITIONAL_FIELDS = ['neckline', 'sleeves', 'length', 'closure', 'pockets'] as const;
const MAX_EXTRA_QUESTIONS = 3;

const categoryLabel = (category: string | null | undefined): string => {
  const type = category ? typeForCategory(category) : undefined;
  return (type && CATEGORIES_BY_TYPE[type].find((c) => c.value === category)?.label) || category || 'sin clasificar';
};

function parseMeta(value: string | null): Record<string, FieldMeta> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, FieldMeta>) : {};
  } catch {
    return {};
  }
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * The questions an analysis leaves open: what the garment IS when that isn't clear, its color when
 * that isn't, and whatever else the model itself said it couldn't tell. `settled` are fields the
 * person already answered or confirmed - never asked again.
 */
export function questionsFor(a: LlmGarmentAnalysis, settled: ReadonlySet<string> = new Set()): GarmentDoubt[] {
  const seen = a.seen ? ` Lo que veo: ${a.seen.replace(/\.$/, '')}.` : '';
  if (!a.isGarment) {
    return [{ field: 'is_garment', question: `En esta foto no reconozco una prenda.${seen} ¿Qué hago con ella?`, options: ['conservar', 'borrar'], suggested: null }];
  }

  const { askBelow, askColorBelow } = env.fashion.llmVision;
  const conf = (field: string) => a.fieldMeta[field]?.confidence ?? 0;
  const modelDoubt = (field: string) => a.doubts.find((d) => d.field === field);
  const several = (a.raw as { varias_prendas?: boolean } | null)?.varias_prendas === true;
  const out: GarmentDoubt[] = [];

  const whatDoubt = modelDoubt('category') ?? modelDoubt('type');
  if (!settled.has('category') && (!a.type || !a.category || conf('category') < askBelow || conf('type') < askBelow || several || whatDoubt)) {
    // A doubt about the type is asked as "which garment is it": the garment decides the type.
    const fromModel = whatDoubt?.field === 'category' ? whatDoubt.options : (whatDoubt?.options ?? []).flatMap((t) => (CATEGORIES_BY_TYPE[t as GarmentType] ?? []).map((c) => c.value));
    const options = fromModel.length ? fromModel : a.type ? CATEGORIES_BY_TYPE[a.type as GarmentType].map((c) => c.value) : [];
    const guess = a.category ? ` La dejé como "${categoryLabel(a.category)}", pero no estoy seguro.` : ' No logré saber qué prenda es.';
    const why = several ? ' En la foto hay varias prendas y no sé cuál es la que quieres guardar.' : '';
    out.push({
      field: 'category',
      question: whatDoubt?.question ? `${whatDoubt.question}${guess}` : `¿Qué prenda es exactamente?${seen}${why}${guess}`,
      options: [...new Set([...(a.category ? [a.category] : []), ...options])].slice(0, 8),
      suggested: a.category,
    });
  }

  if (!settled.has('color') && (!a.color || conf('color') < askColorBelow || modelDoubt('color'))) {
    const d = modelDoubt('color');
    out.push({
      field: 'color',
      question: d?.question ?? `¿De qué color es principalmente?${seen}${a.color ? ` Me parece ${a.color.replace(/_/g, ' ')}, pero la foto no me deja asegurarlo.` : ''}`,
      options: [...new Set([...(a.color ? [a.color] : []), ...(d?.options ?? []), ...a.secondaryColors])].slice(0, 6),
      suggested: a.color,
    });
  }

  let extras = 0;
  for (const d of a.doubts) {
    if (['type', 'category', 'color'].includes(d.field) || settled.has(d.field) || extras >= MAX_EXTRA_QUESTIONS) continue;
    out.push(d);
    extras++;
  }
  return out;
}

/** Replaces a garment's open questions with these. */
export function saveQuestions(userId: number, garmentId: number, doubts: GarmentDoubt[]): void {
  db.prepare("DELETE FROM garment_questions WHERE garment_id = ? AND status = 'open'").run(garmentId);
  const insert = db.prepare('INSERT INTO garment_questions (user_id, garment_id, field, question, options, suggested) VALUES (?, ?, ?, ?, ?, ?)');
  for (const d of doubts) insert.run(userId, garmentId, d.field, d.question, JSON.stringify(d.options), d.suggested);
}

/**
 * Analyzes a new garment's photo onto its draft: the vision LLM when there is one, the local
 * classifier otherwise (or if the LLM failed). Returns false when neither could read it, which the
 * flows treat as "ask the person what it is".
 */
export async function analyzeForDraft(draft: GarmentDraft, analysisCopy: Buffer, userId: number): Promise<boolean> {
  const llm = await llmVision.analyze(draft.imageUrl, userId);
  if (llm && llm.isGarment) {
    applyVisionAnalysis(draft, llm);
    if (llm.subcategory) draft.subcategory = llm.subcategory;
    if (llm.gender) draft.gender = llm.gender;
    if (llm.season.length) draft.season = llm.season;
    if (llm.weather.length) draft.weather = llm.weather;
    if (llm.occasions.length) draft.occasions = llm.occasions;
    if (llm.brand) draft.brand = llm.brand;
    draft.doubts = questionsFor(llm);
    return true;
  }
  const local = await httpVisionService.analyze(analysisCopy);
  if (!local) return false;
  applyVisionAnalysis(draft, local);
  return true;
}

/**
 * Saves a just-created garment's open questions. `confirmedByChat` is for the single-photo flow,
 * where the person already said "sí, guardar así" to what it is and its color.
 */
export function saveDraftQuestions(userId: number, garmentId: number, draft: GarmentDraft, confirmedByChat = false): void {
  const doubts = (draft.doubts ?? []).filter((d) => !confirmedByChat || !['category', 'color'].includes(d.field));
  if (doubts.length) saveQuestions(userId, garmentId, doubts);
}

function rebuildDescriptions(g: Garment, patch: GarmentUpdateFields): Pick<GarmentUpdateFields, 'shortDescription' | 'longDescription'> {
  const pick = <K extends keyof GarmentUpdateFields>(key: K, current: unknown) => (patch[key] === undefined ? current : patch[key]);
  const input = {
    type: pick('type', g.type) as string,
    category: pick('category', g.category) as string,
    color: pick('color', g.color) as string | null,
    secondaryColors: pick('secondaryColors', parseList(g.secondary_colors)) as string[] | null,
    pattern: pick('pattern', g.pattern) as string | null,
    material: pick('material', g.material) as string | null,
    fit: pick('fit', g.fit) as string | null,
    style: pick('style', parseList(g.style)) as string[] | null,
    formality: pick('formality', g.formality) as string | null,
    neckline: pick('neckline', g.neckline) as string | null,
    sleeves: pick('sleeves', g.sleeves) as string | null,
    closure: pick('closure', g.closure) as string | null,
    pockets: pick('pockets', g.pockets) as string | null,
    length: pick('length', g.length) as string | null,
  };
  return { shortDescription: buildShortDescription(input), longDescription: buildLongDescription(input) };
}

/**
 * Classifies an already-saved garment again with the vision LLM and writes what it found - except
 * the fields the person set themselves. 'failed' = couldn't be read this time (counted, and given
 * up on after a few tries: see reclassifyPending).
 */
export async function reclassifyGarment(g: Garment): Promise<'ok' | 'failed'> {
  const a = await llmVision.analyze(g.image_url, g.user_id);
  if (!a) {
    db.prepare('UPDATE garments SET llm_attempts = llm_attempts + 1 WHERE id = ?').run(g.id);
    return 'failed';
  }

  const oldMeta = parseMeta(g.analysis_confidence);
  const settled = new Set(Object.entries(oldMeta).filter(([, m]) => m.byUser).map(([field]) => field));
  const patch: GarmentUpdateFields = {};
  const set = (field: string, value: unknown) => {
    if (!settled.has(field)) (patch as Record<string, unknown>)[field] = value;
  };

  if (a.isGarment) {
    if (a.type && a.category && !settled.has('category')) {
      patch.type = a.type;
      patch.category = a.category;
    }
    for (const field of ['color', 'pattern', 'material', 'fit', 'formality', 'warmth', 'waterResistance', 'gender', 'subcategory'] as const) {
      if (a[field]) set(field, a[field]);
    }
    for (const field of CONDITIONAL_FIELDS) set(field, a[field]);
    for (const field of ['secondaryColors', 'style', 'season', 'weather', 'occasions'] as const) {
      if (a[field].length || field === 'secondaryColors') set(field, a[field].length ? a[field] : null);
    }
    if (a.brand && !g.brand) set('brand', a.brand);
  }

  const meta: Record<string, FieldMeta> = { ...a.fieldMeta };
  for (const field of settled) meta[field] = oldMeta[field];
  garmentsRepo.update(g.user_id, g.id, {
    ...patch,
    ...rebuildDescriptions(g, patch),
    analysisConfidence: meta,
    analysisModel: a.modelName,
    analyzedAt: new Date().toISOString(),
  });
  db.prepare('UPDATE garments SET ai_metadata = ? WHERE id = ?').run(JSON.stringify(a.raw), g.id);
  saveQuestions(g.user_id, g.id, questionsFor(a, settled));
  return 'ok';
}

const MAX_ATTEMPTS = 3;
const PENDING_SQL = `is_active = 1 AND (analysis_model IS NULL OR analysis_model NOT LIKE 'fal:%') AND llm_attempts < ${MAX_ATTEMPTS}`;

/** Sends the wardrobe's owner a WhatsApp when their reclassification is done - set from index.ts. */
let notify: ((userId: number, text: string) => Promise<unknown>) | undefined;
export function setWardrobeNotifier(fn: typeof notify): void {
  notify = fn;
}

/**
 * Reclassifies the garments the vision LLM hasn't seen yet, one at a time. Called from upkeep.ts;
 * does nothing without a fal.ai key. Returns how many it classified.
 */
export async function reclassifyPending(limit: number): Promise<{ done: number; failed: number }> {
  if (!llmVision.enabled()) return { done: 0, failed: 0 };
  const pending = db.prepare(`SELECT * FROM garments WHERE ${PENDING_SQL} ORDER BY id LIMIT ?`).all(limit) as Garment[];
  let done = 0;
  let failed = 0;
  const perUser = new Map<number, number>();
  for (const g of pending) {
    const outcome = await reclassifyGarment(g).catch((err) => {
      console.error('[FASHION] No se pudo reclasificar la prenda #%d:', g.id, (err as Error).message);
      db.prepare('UPDATE garments SET llm_attempts = llm_attempts + 1 WHERE id = ?').run(g.id);
      return 'failed' as const;
    });
    if (outcome === 'ok') {
      done++;
      perUser.set(g.user_id, (perUser.get(g.user_id) ?? 0) + 1);
    } else failed++;
  }

  // Worth a message only when a whole wardrobe was gone through, not for a stray garment.
  for (const [userId, count] of perUser) {
    const status = reviewStatus(userId);
    if (count < 5 || status.pending > 0 || !notify) continue;
    const link = env.panelUrl ? `\n${env.panelUrl.replace(/\/$/, '')}/app#/wardrobe?tab=review` : '';
    const details = status.open_questions - status.main_questions;
    const ask = status.open_questions
      ? `Te dejé preguntas en el portal, en *Mi armario → Por revisar*: *${status.main_questions}* sobre qué prenda es o su color, y ${details} de detalle (material y parecidos) que por foto no se pueden asegurar.${link}`
      : 'Quedó todo clasificado, sin dudas pendientes.';
    await notify(userId, `👕 *Armario reclasificado*\n\nRevisé ${status.total} prenda(s) mirando cada foto. ${ask}`).catch(() => {});
  }
  return { done, failed };
}

/** Sends a person's whole wardrobe back through classification ("actualizar ropa"). */
export function queueReclassification(userId: number): number {
  return db
    .prepare(`UPDATE garments SET analysis_model = NULL, llm_attempts = 0 WHERE user_id = ? AND is_active = 1`)
    .run(userId).changes;
}

export function reviewStatus(userId: number): { enabled: boolean; total: number; classified: number; pending: number; unreadable: number; open_questions: number; main_questions: number; garments_to_review: number; main_garments: number } {
  const one = (sql: string) => (db.prepare(sql).get(userId) as { c: number }).c;
  return {
    enabled: llmVision.enabled(),
    total: one('SELECT COUNT(*) AS c FROM garments WHERE user_id = ? AND is_active = 1'),
    classified: one(`SELECT COUNT(*) AS c FROM garments WHERE user_id = ? AND is_active = 1 AND analysis_model LIKE 'fal:%'`),
    pending: one(`SELECT COUNT(*) AS c FROM garments WHERE user_id = ? AND ${PENDING_SQL}`),
    unreadable: one(`SELECT COUNT(*) AS c FROM garments WHERE user_id = ? AND is_active = 1 AND (analysis_model IS NULL OR analysis_model NOT LIKE 'fal:%') AND llm_attempts >= ${MAX_ATTEMPTS}`),
    open_questions: one("SELECT COUNT(*) AS c FROM garment_questions WHERE user_id = ? AND status = 'open'"),
    main_questions: one(`SELECT COUNT(*) AS c FROM garment_questions WHERE user_id = ? AND status = 'open' AND field IN (${MAIN_QUESTION_FIELDS.map((f) => `'${f}'`).join(', ')})`),
    main_garments: one(`SELECT COUNT(DISTINCT garment_id) AS c FROM garment_questions WHERE user_id = ? AND status = 'open' AND field IN (${MAIN_QUESTION_FIELDS.map((f) => `'${f}'`).join(', ')})`),
    garments_to_review: one("SELECT COUNT(DISTINCT garment_id) AS c FROM garment_questions WHERE user_id = ? AND status = 'open'"),
  };
}

export function openQuestions(userId: number, garmentId?: number): GarmentQuestion[] {
  return garmentId === undefined
    ? (db.prepare("SELECT * FROM garment_questions WHERE user_id = ? AND status = 'open' ORDER BY garment_id, id").all(userId) as GarmentQuestion[])
    : (db.prepare("SELECT * FROM garment_questions WHERE user_id = ? AND garment_id = ? AND status = 'open' ORDER BY id").all(userId, garmentId) as GarmentQuestion[]);
}

/**
 * Writes what the person says about a garment (a portal answer or edit), checked against the
 * taxonomy, and marks each field as theirs. Returns an error text when a value isn't valid.
 */
export function applyUserFields(userId: number, garmentId: number, input: Record<string, unknown>): { ok: true } | { error: string } {
  const g = garmentsRepo.getById(userId, garmentId);
  if (!g) return { error: 'No existe esa prenda.' };

  const patch: GarmentUpdateFields = {};
  const touched: string[] = [];
  const put = (field: string, value: unknown) => {
    (patch as Record<string, unknown>)[field] = value;
    touched.push(field);
  };

  for (const [field, raw] of Object.entries(input)) {
    if (raw === undefined || field === 'type') continue;
    const empty = raw === null || raw === '';
    if (field === 'category') {
      const type = typeof raw === 'string' ? typeForCategory(raw) : undefined;
      if (!type) return { error: 'Esa prenda no está en la lista.' };
      patch.type = type;
      put('category', raw);
    } else if (FIELD_POOLS[field] || EXTRA_POOLS[field]) {
      const pool = FIELD_POOLS[field] ?? EXTRA_POOLS[field];
      if (!empty && !pool.includes(String(raw))) return { error: `"${String(raw)}" no es un valor válido para ${FIELD_LABELS[field] ?? field}.` };
      put(field, empty ? null : String(raw));
    } else if (LIST_POOLS[field]) {
      const values = Array.isArray(raw) ? raw.map(String) : empty ? [] : [String(raw)];
      const bad = values.find((v) => !LIST_POOLS[field].includes(v));
      if (bad) return { error: `"${bad}" no es un valor válido para ${FIELD_LABELS[field] ?? field}.` };
      put(field, values.length ? [...new Set(values)] : null);
    } else if ((FREE_TEXT_FIELDS as readonly string[]).includes(field)) {
      put(field, empty ? null : String(raw).trim().slice(0, 300));
    }
  }
  // A type on its own (no category) only makes sense if it matches the garment's category already.
  if (touched.length === 0) return { ok: true };

  const meta = parseMeta(g.analysis_confidence);
  for (const field of touched) meta[field] = { confidence: 1, tier: 'alta', certainty: 'observado', byUser: true };
  if (touched.includes('category')) meta.type = meta.category;
  garmentsRepo.update(userId, garmentId, { ...patch, ...rebuildDescriptions(g, patch), analysisConfidence: meta });

  const close = db.prepare("UPDATE garment_questions SET status = 'answered', answer = ?, answered_at = datetime('now') WHERE garment_id = ? AND field = ? AND status = 'open'");
  for (const field of touched) {
    const value = (patch as Record<string, unknown>)[field];
    close.run(Array.isArray(value) ? value.join(', ') : value === null ? '' : String(value), garmentId, field);
  }
  return { ok: true };
}

/** Answers one question. For "this isn't a garment": 'borrar' deletes it, 'conservar' keeps it as is. */
export async function answerQuestion(userId: number, questionId: number, value: unknown): Promise<{ ok: true; removed?: boolean } | { error: string }> {
  const q = db.prepare("SELECT * FROM garment_questions WHERE id = ? AND user_id = ? AND status = 'open'").get(questionId, userId) as GarmentQuestion | undefined;
  if (!q) return { error: 'Esa pregunta ya no está pendiente.' };

  if (q.field === 'is_garment') {
    if (value === 'borrar') {
      const gone = garmentsRepo.remove(userId, q.garment_id);
      if (gone) await spacesStorageService.delete([gone.storageKey, ...(gone.thumbnailKey ? [gone.thumbnailKey] : [])]).catch(() => {});
      return { ok: true, removed: true };
    }
    db.prepare("UPDATE garment_questions SET status = 'answered', answer = 'conservar', answered_at = datetime('now') WHERE id = ?").run(q.id);
    return { ok: true };
  }
  if (value === null || value === undefined || value === '') return { error: 'Elige una opción.' };
  return applyUserFields(userId, q.garment_id, { [q.field]: value });
}

/** "No sé / déjalo así": the question goes away and what was guessed stays. */
export function skipQuestion(userId: number, questionId: number): boolean {
  return db.prepare("UPDATE garment_questions SET status = 'skipped', answered_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'open'").run(questionId, userId).changes > 0;
}
