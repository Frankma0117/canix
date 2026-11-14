import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { env } from '../../../config/env.js';
import { AccessError } from '../../../models/permissions.model.js';
import { ensureBudget, resolveMedia, usedThisMonth, generationCap } from '../publisher-media.js';
import { publisherStore } from '../publisher.store.js';
import { currentArtProvider } from './studio-art.js';
import { deleteStudioFiles, usesArt } from './studio-build.js';
import { canCompose } from './studio-compose.js';
import { studioStore } from './studio.store.js';
import { DEFAULT_COLORS, FONTS, FORMATS, LAYOUTS, formatByKey, type Colors, type Design, type DesignKind, type DesignLayout, type FontKey, type Identity } from './studio.types.js';

/**
 * Brand studio: asks for designs, runs them ONE AT A TIME in a low-priority child process
 * (studio-worker.ts), and handles identity, review, text corrections and deletion. Nothing here is
 * public: the routes are admin-only.
 */
const WORKER = fileURLToPath(new URL('./studio-worker.ts', import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const queue: number[] = [];
let running = false;
let composeOk: boolean | null = null;

function runNext(): void {
  if (running) return;
  const id = queue.shift();
  if (id === undefined) return;
  running = true;
  const child = spawn(process.execPath, [TSX_CLI, WORKER, String(id)], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  try {
    if (child.pid) setPriority(child.pid, 10);
  } catch {
    /* Windows (development) - fine */
  }
  const done = () => {
    const d = studioStore.get(id);
    if (d && ['pending', 'working'].includes(d.status)) studioStore.setStatus(id, 'error', 'El proceso de diseño se detuvo.');
    running = false;
    runNext();
  };
  child.on('exit', done);
  child.on('error', (err) => {
    studioStore.setStatus(id, 'error', `No se pudo iniciar el diseño: ${err.message}`);
    running = false;
    runNext();
  });
}

const enqueue = (id: number) => {
  if (!queue.includes(id)) queue.push(id);
  runNext();
};

/** After a restart, whatever was half-made goes back to the queue. */
export function resumeStudioQueue(): void {
  studioStore.requeue().forEach(enqueue);
}

// ---------- reading ----------

export function designView(d: Design) {
  return {
    id: d.id,
    kind: d.kind,
    layout: d.layout,
    format: d.format,
    formatLabel: formatByKey(d.format)?.label ?? d.format,
    brief: d.brief,
    useAi: !!d.use_ai,
    status: d.status,
    detail: d.detail,
    title: d.title,
    caption: d.caption,
    content: d.content,
    url: resolveMedia(d.file_ref),
    createdAt: `${d.created_at.replace(' ', 'T')}Z`,
  };
}

export const listDesigns = () => studioStore.list().map(designView);

export async function studioStatus() {
  if (composeOk === null) composeOk = await canCompose();
  const art = currentArtProvider();
  return {
    canCompose: composeOk,
    textAi: !!env.ai.apiKey,
    art: { key: art.key, label: art.label },
    identity: identityView(),
    formats: FORMATS.map(({ key, kind, label, width, height }) => ({ key, kind, label, width, height })),
    layouts: Object.entries(LAYOUTS).map(([key, l]) => ({ key, label: l.label, usesArt: l.usesArt, kinds: l.kinds })),
    fonts: Object.entries(FONTS).map(([key, f]) => ({ key, label: f.label })),
    budget: { cap: generationCap(), used: usedThisMonth() },
  };
}

// ---------- identity ----------

export function identityView() {
  const i = studioStore.getIdentity();
  return { colors: i.colors, style: i.style, font: i.font, logoUrl: resolveMedia(i.logoRef) };
}

const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : fallback);

export function saveIdentity(input: { colors?: Partial<Colors>; style?: string; font?: string }): ReturnType<typeof identityView> {
  const prev = studioStore.getIdentity();
  const next: Identity = {
    colors: {
      primary: color(input.colors?.primary, prev.colors.primary),
      secondary: color(input.colors?.secondary, prev.colors.secondary),
      accent: color(input.colors?.accent, prev.colors.accent),
      dark: color(input.colors?.dark, prev.colors.dark),
      light: color(input.colors?.light, prev.colors.light),
    },
    style: (input.style ?? prev.style).trim().slice(0, 300),
    font: (input.font && input.font in FONTS ? input.font : prev.font) as FontKey,
    logoRef: prev.logoRef,
  };
  studioStore.saveIdentity(next);
  return identityView();
}

export function resetColors() {
  const prev = studioStore.getIdentity();
  studioStore.saveIdentity({ ...prev, colors: { ...DEFAULT_COLORS } });
  return identityView();
}

// ---------- making ----------

export interface CreateDesign {
  kind: string;
  layout?: string;
  formats: string[];
  brief?: string;
  count?: number;
}

export function createDesigns(adminId: number, input: CreateDesign) {
  const kind = input.kind as DesignKind;
  if (!['logo', 'cover', 'profile', 'post', 'story'].includes(kind)) throw new AccessError('Elige qué quieres diseñar.');
  const formats = FORMATS.filter((f) => f.kind === kind && input.formats.includes(f.key));
  if (!formats.length) throw new AccessError('Elige al menos un formato.');
  const count = Math.max(1, Math.min(4, Math.trunc(input.count ?? 1)));
  const defaults: Record<DesignKind, DesignLayout[]> = { logo: ['mark'], profile: ['mark'], cover: ['banner'], post: ['hero', 'tip', 'quote', 'split'], story: ['hero', 'tip', 'quote', 'split'] };
  const allowed = defaults[kind];
  const wanted = input.layout && input.layout !== 'auto' ? (input.layout as DesignLayout) : undefined;
  if (wanted && !(wanted in LAYOUTS && LAYOUTS[wanted].kinds.includes(kind))) throw new AccessError('Ese diseño no sirve para esta pieza.');
  const pieces: { format: string; layout: DesignLayout }[] = [];
  for (let n = 0; n < count; n++) for (const f of formats) pieces.push({ format: f.key, layout: wanted ?? allowed[n % allowed.length] });
  const ai = pieces.filter((p) => usesArt({ kind, layout: p.layout })).length;
  if (ai && currentArtProvider().key === 'fal') ensureBudget(ai);
  const ids = pieces.map((p) =>
    studioStore.create({ kind, layout: p.layout, format: p.format, brief: (input.brief ?? '').trim().slice(0, 500), useAi: usesArt({ kind, layout: p.layout }) && currentArtProvider().key === 'fal', createdBy: adminId }),
  );
  ids.forEach(enqueue);
  return ids.map((id) => designView(load(id)));
}

function load(id: number): Design {
  const d = studioStore.get(id);
  if (!d) throw new AccessError('Ese diseño ya no existe.');
  return d;
}

const busy = (d: Design) => ['pending', 'working'].includes(d.status);

export function reviewDesign(id: number, approve: boolean) {
  const d = load(id);
  if (!['review', 'approved', 'rejected'].includes(d.status)) throw new AccessError('Todavía no está listo.');
  studioStore.review(id, approve);
  return designView(load(id));
}

/** Corrected words → the design is photographed again with the same art (no AI spent). */
export function editDesign(id: number, changes: { headline?: string; sub?: string; cta?: string; bullets?: string[]; caption?: string }) {
  const d = load(id);
  if (busy(d)) throw new AccessError('Se está creando: espera a que termine.');
  const c = d.content;
  const clip = (v: string | undefined, max: number, prev = '') => (v === undefined ? prev : v.trim().slice(0, max) || prev);
  const bullets = changes.bullets?.map((b) => b.trim().slice(0, 40)).filter(Boolean);
  const headline = clip(changes.headline, 90, c.headline);
  studioStore.setContent(id, headline || d.title, changes.caption === undefined ? d.caption : changes.caption.trim().slice(0, 600), {
    ...c,
    headline,
    sub: clip(changes.sub, 110, c.sub),
    cta: clip(changes.cta, 28, c.cta),
    bullets: bullets && bullets.length >= 3 ? bullets : c.bullets,
  });
  studioStore.setStatus(id, 'pending', 'En cola');
  enqueue(id);
  return designView(load(id));
}

/** «Otra versión»: same brief, new words and new art. Costs like a new design. */
export function redoDesign(adminId: number, id: number) {
  const d = load(id);
  return createDesigns(adminId, { kind: d.kind, layout: d.layout, formats: [d.format], brief: d.brief, count: 1 });
}

export async function deleteDesign(id: number): Promise<void> {
  const d = load(id);
  if (busy(d)) throw new AccessError('Se está creando: espera a que termine.');
  if (publisherStore.getSetting('logo_design') === String(id)) throw new AccessError('Es el logo en uso: elige otro logo antes de borrarlo.');
  await deleteStudioFiles(id);
  studioStore.delete(id);
}

/** An approved logo becomes THE logo: every layout draws it from then on. */
export function useAsLogo(id: number) {
  const d = load(id);
  if (d.kind !== 'logo' || d.status !== 'approved') throw new AccessError('Aprueba primero ese logo.');
  studioStore.saveIdentity({ ...studioStore.getIdentity(), logoRef: d.file_ref });
  publisherStore.setSetting('logo_design', String(id));
  return identityView();
}
