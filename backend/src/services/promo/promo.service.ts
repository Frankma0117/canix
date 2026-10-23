import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promoModel } from '../../models/promo.model.js';
import { VOICES } from '../audio/voices.js';
import { isFishConfigured } from '../audio/fish-audio.js';
import { env } from '../../config/env.js';
import type { PromoItem, PromoKind, PromoMedia } from '../../entities/promo.entity.js';
import { AccessError } from '../../models/permissions.model.js';
import { FEATURES, FEATURE_KEYS, IMAGE_FORMATS, IMAGE_LAYOUTS, KINDS, MUSIC, VIDEO_FORMATS } from './promo-catalog.js';
import { DEFAULT_VOICE } from './promo-build.js';
import { canRender } from './promo-render.js';
import { deleteItemFiles, publicUrl, usesSpaces } from './promo-storage.js';

/**
 * Advertising material for the administrator (portal → Videos y publicidad): creates the requests,
 * runs them ONE AT A TIME in a low-priority child process (promo-worker.ts), and handles review,
 * text corrections and deletion. Nothing here is public: the routes are admin-only.
 */

const WORKER = fileURLToPath(new URL('./promo-worker.ts', import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const queue: number[] = [];
let running = false;
let renderOk: boolean | null = null;

function runNext(): void {
  if (running) return;
  const id = queue.shift();
  if (id === undefined) return;
  running = true;
  const child = spawn(process.execPath, [TSX_CLI, WORKER, String(id)], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  try {
    if (child.pid) setPriority(child.pid, 10); // the browser and ffmpeg it starts inherit it
  } catch {
    /* Windows (development) - fine */
  }
  child.on('exit', (code) => {
    const item = promoModel.get(id);
    if (item && ['pending', 'working'].includes(item.status)) promoModel.setStatus(id, 'error', code ? 'El proceso de grabación se detuvo.' : 'No terminó.');
    running = false;
    runNext();
  });
  child.on('error', (err) => {
    promoModel.setStatus(id, 'error', `No se pudo iniciar la grabación: ${err.message}`);
    running = false;
    runNext();
  });
}

function enqueue(id: number): void {
  if (!queue.includes(id)) queue.push(id);
  runNext();
}

/** After a restart, whatever was half-made goes back to the queue. */
export function resumePromoQueue(): void {
  promoModel.requeue().forEach(enqueue);
}

// ---------- reading ----------

function view(p: PromoItem) {
  const feature = FEATURES.find((f) => f.key === p.feature);
  return {
    id: p.id,
    media: p.media,
    kind: p.kind,
    feature: p.feature,
    featureName: feature ? `${feature.emoji} ${feature.name}` : null,
    layout: p.layout,
    formats: p.formats,
    status: p.status,
    detail: p.detail,
    idea: p.idea,
    title: p.title,
    caption: p.caption,
    content: p.content,
    voice: p.voice,
    files: Object.fromEntries(Object.entries(p.files).map(([fmt, f]) => [fmt, { url: publicUrl(f.file), poster: publicUrl(f.poster), seconds: f.seconds ?? null }])),
    createdAt: `${p.created_at.replace(' ', 'T')}Z`,
  };
}

export async function promoStatus() {
  if (renderOk === null) renderOk = await canRender();
  return {
    canRender: renderOk,
    textAi: !!env.ai.apiKey,
    voice: isFishConfigured(),
    music: !!env.fal.apiKey,
    storage: usesSpaces() ? 'spaces' : 'local',
    voices: VOICES.map(({ key, name, gender, style }) => ({ key, name, gender, style })),
    voiceKey: promoModel.getSetting('voice') ?? DEFAULT_VOICE,
    musicOptions: [...MUSIC.map(({ key, name }) => ({ key, name })), { key: 'none', name: 'Sin música' }],
    musicKey: promoModel.getSetting('music') ?? 'moderna',
    features: FEATURES.map(({ key, name, emoji }) => ({ key, name, emoji })),
  };
}

export function listPromo() {
  return promoModel.list().map(view);
}

function load(id: number): PromoItem {
  const item = promoModel.get(id);
  if (!item) throw new AccessError('Ese elemento ya no existe.');
  return item;
}

// ---------- writing ----------

export function saveSettings(input: { voice?: string; music?: string }): void {
  if (input.voice !== undefined) {
    if (!VOICES.some((v) => v.key === input.voice)) throw new AccessError('Esa voz no existe.');
    promoModel.setSetting('voice', input.voice);
  }
  if (input.music !== undefined) {
    if (input.music !== 'none' && !MUSIC.some((m) => m.key === input.music)) throw new AccessError('Esa música no existe.');
    promoModel.setSetting('music', input.music);
  }
}

export interface CreateInput {
  media: PromoMedia;
  kind: string;
  feature?: string | null;
  formats: string[];
  layout?: string;
  count?: number;
  idea?: string;
}

export function createPromo(adminId: number, input: CreateInput) {
  const kind = input.kind as PromoKind;
  if (!KINDS.includes(kind)) throw new AccessError('Elige qué quieres hacer.');
  const feature = input.feature && FEATURE_KEYS.includes(input.feature) ? input.feature : null;
  if (kind === 'feature' && !feature) throw new AccessError('Elige la función que quieres mostrar.');
  const allowed: readonly string[] = input.media === 'video' ? VIDEO_FORMATS : IMAGE_FORMATS;
  const formats = allowed.filter((f) => input.formats.includes(f));
  if (!formats.length) throw new AccessError('Elige al menos un formato.');
  const count = Math.max(1, Math.min(3, Math.trunc(input.count ?? 1)));
  // Images: «auto» varies the design between the images of one request.
  const layouts =
    input.media === 'image'
      ? IMAGE_LAYOUTS.includes(input.layout as (typeof IMAGE_LAYOUTS)[number])
        ? Array<string>(count).fill(input.layout!)
        : [...IMAGE_LAYOUTS].slice(0, count)
      : [null];
  const voice = input.media === 'video' ? (promoModel.getSetting('voice') ?? DEFAULT_VOICE) : null;
  const ids = layouts.map((layout) =>
    promoModel.create({ media: input.media, kind, feature, layout, formats, idea: (input.idea ?? '').trim().slice(0, 500), voice, createdBy: adminId, detail: 'En cola' }),
  );
  ids.forEach(enqueue);
  return ids.map((id) => view(load(id)));
}

export function reviewPromo(id: number, approve: boolean) {
  const item = load(id);
  if (!['review', 'approved', 'rejected'].includes(item.status)) throw new AccessError('Todavía no está listo.');
  promoModel.review(id, approve);
  return view(load(id));
}

export function updatePromoTexts(id: number, title: string, caption: string) {
  load(id);
  promoModel.updateTexts(id, title.trim().slice(0, 90), caption.trim().slice(0, 400));
  return view(load(id));
}

/** Images: the admin corrects the texts and the image is drawn again with them (no AI). */
export function redrawImage(id: number, changes: { headline?: string; sub?: string; cta?: string; bullets?: string[] }) {
  const item = load(id);
  if (item.media !== 'image') throw new AccessError('Solo las imágenes se vuelven a dibujar.');
  if (['pending', 'working'].includes(item.status)) throw new AccessError('Se está creando: espera a que termine.');
  const c = item.content;
  const clip = (v: string | undefined, max: number, prev = '') => (v === undefined ? prev : v.trim().slice(0, max) || prev);
  const bullets = changes.bullets?.map((b) => b.trim().slice(0, 40)).filter(Boolean);
  promoModel.setContent(id, item.title, item.caption, {
    ...c,
    headline: clip(changes.headline, 60, c.headline),
    sub: clip(changes.sub, 160, c.sub),
    cta: clip(changes.cta, 32, c.cta),
    bullets: bullets?.length === 3 ? bullets : c.bullets,
  });
  promoModel.setStatus(id, 'pending', 'En cola');
  enqueue(id);
  return view(load(id));
}

export async function deletePromo(id: number): Promise<void> {
  const item = load(id);
  if (['pending', 'working'].includes(item.status)) throw new AccessError('Se está creando: espera a que termine.');
  await deleteItemFiles(id);
  promoModel.delete(id);
}
