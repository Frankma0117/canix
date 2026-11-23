import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { db } from '../../database/connection.js';
import { AccessError } from '../../models/permissions.model.js';
import { putFile, publicUrl, deleteItemFiles } from '../promo/promo-storage.js';
import { canixTemplate, GROUP_KINDS, parseSpec, type VideoSpec } from './spec.js';

/**
 * "Taller" Remotion videos (callouts + full-body mascot) managed from the admin panel.
 * The taller lives on the server (VIDEO_TALLER_DIR, e.g. /opt/videos/taller); without it
 * (local dev) everything but rendering works and the panel says so. Renders run one at a time,
 * low priority (nice/ionice, 1 thread). Flow: draft -> silent low-res preview (review) -> approve -> final render -> Spaces -> approved (local mp4 deleted).
 */

export type VideoStatus = 'draft' | 'previewing' | 'rendering' | 'review' | 'approved' | 'error';
export interface VideoRow {
  id: number;
  title: string;
  spec: VideoSpec;
  status: VideoStatus;
  detail: string;
  file: string | null;
  preview_file: string | null;
  group_id: string | null;
  kind: string;
  url: string;
  has_preview: boolean;
  created_at: string;
  updated_at: string;
}
type Raw = Omit<VideoRow, 'spec' | 'url' | 'has_preview'> & { spec: string };

const TALLER = (process.env.VIDEO_TALLER_DIR ?? '').trim();
const OUT = TALLER ? resolve(TALLER, '..', 'out') : '';
const TMP = TALLER ? resolve(TALLER, '..', 'tmp') : '';
const PROJECTS = TALLER ? join(TALLER, 'public', 'proyectos') : '';
const IMAGE = /\.(png|jpe?g|webp)$/i;

export const available = () => !!TALLER && existsSync(join(TALLER, 'tools', 'env.sh'));

function toRow(r: Raw): VideoRow {
  const approved = r.status === 'approved' && r.file;
  return { ...r, spec: JSON.parse(r.spec) as VideoSpec, url: approved ? publicUrl(r.file) : '', has_preview: !!r.preview_file };
}

export function list(): VideoRow[] {
  return (db.prepare('SELECT * FROM video_specs ORDER BY id DESC LIMIT 200').all() as Raw[]).map(toRow);
}

function get(id: number): Raw {
  const r = db.prepare('SELECT * FROM video_specs WHERE id = ?').get(id) as Raw | undefined;
  if (!r) throw new AccessError('Ese video no existe.');
  return r;
}

const busy = (s: VideoStatus) => s === 'previewing' || s === 'rendering';
const dropPreview = (cur: Raw) => {
  if (cur.preview_file && OUT) rmSync(join(OUT, cur.preview_file), { force: true });
};

export function create(userId: number, title: string, spec?: unknown): VideoRow[] {
  const clean = parseSpec(spec ?? canixTemplate());
  db.prepare('INSERT INTO video_specs (title, spec, created_by) VALUES (?, ?, ?)').run(title.trim() || clean.intro.title, JSON.stringify(clean), userId);
  return list();
}

/** One "recuadros" request = 3 drafts (Reel, Instagram, guided tutorial) sharing a group id. */
export function createGroup(userId: number, title: string): VideoRow[] {
  const group = randomUUID();
  const base = title.trim();
  const ins = db.prepare('INSERT INTO video_specs (title, spec, group_id, kind, created_by) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const g of GROUP_KINDS) {
      const spec = parseSpec(canixTemplate(g.format, g.guide));
      ins.run(`${base || spec.intro.title} · ${g.title}`, JSON.stringify(spec), group, g.kind, userId);
    }
  })();
  return list();
}

export function update(id: number, title: string, spec: unknown): VideoRow[] {
  const cur = get(id);
  if (busy(cur.status)) throw new AccessError('Espera a que termine el render para editarlo.');
  if (cur.status === 'approved') throw new AccessError('Este video ya está aprobado; duplícalo para hacer otra versión.');
  const clean = parseSpec(spec);
  // Editing sends it back to draft: the preview no longer matches the spec.
  dropPreview(cur);
  db.prepare("UPDATE video_specs SET title = ?, spec = ?, status = 'draft', preview_file = NULL, detail = '', updated_at = datetime('now') WHERE id = ?").run(title.trim() || clean.intro.title, JSON.stringify(clean), id);
  return list();
}

export async function remove(id: number): Promise<void> {
  const cur = get(id);
  if (busy(cur.status)) throw new AccessError('Espera a que termine el render para borrarlo.');
  dropPreview(cur);
  if (cur.status === 'approved') await deleteItemFiles(`studio-${id}`);
  db.prepare('DELETE FROM video_specs WHERE id = ?').run(id);
}

// ---- render (one at a time) ----

let chain: Promise<void> = Promise.resolve();

function enqueue(id: number, silentPreview: boolean): VideoRow[] {
  if (!available()) throw new AccessError('El taller de video no está disponible en este servidor.');
  const cur = get(id);
  if (busy(cur.status)) throw new AccessError('Ya se está generando.');
  if (cur.status === 'approved') throw new AccessError('Este video ya está aprobado; duplícalo para hacer otra versión.');
  if (silentPreview) dropPreview(cur);
  db.prepare("UPDATE video_specs SET status = ?, preview_file = CASE WHEN ? THEN NULL ELSE preview_file END, detail = 'En cola…', updated_at = datetime('now') WHERE id = ?").run(silentPreview ? 'previewing' : 'rendering', silentPreview ? 1 : 0, id);
  chain = chain.then(() => runRender(id, silentPreview)).catch(() => undefined);
  return list();
}

/** "Grabar versión previa": half size, strong compression, silent. */
export const preview = (id: number): VideoRow[] => enqueue(id, true);

/** Approve: renders the final version; the file then goes to Spaces and leaves the disk. */
export function approve(id: number): VideoRow[] {
  const cur = get(id);
  if (cur.status !== 'review' && cur.status !== 'draft' && cur.status !== 'error') throw new AccessError('Este video no se puede aprobar ahora.');
  return enqueue(id, false);
}

/** Discard the preview and go back to editing. */
export function discard(id: number): VideoRow[] {
  const cur = get(id);
  if (cur.status !== 'review') throw new AccessError('No hay versión previa que descartar.');
  dropPreview(cur);
  db.prepare("UPDATE video_specs SET status = 'draft', preview_file = NULL, detail = 'Descartado; ajústalo y graba otra versión previa.', updated_at = datetime('now') WHERE id = ?").run(id);
  return list();
}

function runRender(id: number, silentPreview: boolean): Promise<void> {
  const row = db.prepare('SELECT spec FROM video_specs WHERE id = ?').get(id) as { spec: string } | undefined;
  if (!row) return Promise.resolve();
  const props = join(TMP, `studio-${id}.json`);
  const name = `studio-${id}-${silentPreview ? 'preview-' : ''}${Date.now()}.mp4`;
  writeFileSync(props, row.spec);
  db.prepare('UPDATE video_specs SET detail = ? WHERE id = ?').run(silentPreview ? 'Grabando la versión previa…' : 'Generando la versión final…', id);
  const flags = silentPreview ? '--scale=0.5 --crf=32 --muted ' : '';
  const cmd = `source tools/env.sh && nice -n 19 ionice -c3 npx remotion render src/index.ts Promo "${join(OUT, name)}" --props="${props}" --concurrency=1 ${flags}--log=error`;
  return new Promise((done) => {
    const child = spawn('bash', ['-c', cmd], { cwd: TALLER, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-600)));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    let ended = false;
    const fail = (why: string) => db.prepare("UPDATE video_specs SET status = 'error', detail = ?, updated_at = datetime('now') WHERE id = ?").run(why.slice(0, 300) || 'No se pudo generar el video.', id);
    const finish = async (ok: boolean, why: string) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      rmSync(props, { force: true });
      const path = join(OUT, name);
      try {
        if (!ok) fail(why);
        else if (silentPreview) db.prepare("UPDATE video_specs SET status = 'review', preview_file = ?, detail = '', updated_at = datetime('now') WHERE id = ?").run(name, id);
        else {
          const ref = await putFile(`studio-${id}`, 'video.mp4', readFileSync(path), 'video/mp4');
          const cur = db.prepare('SELECT preview_file FROM video_specs WHERE id = ?').get(id) as { preview_file: string | null } | undefined;
          if (cur?.preview_file) rmSync(join(OUT, cur.preview_file), { force: true });
          db.prepare("UPDATE video_specs SET status = 'approved', file = ?, preview_file = NULL, detail = '', updated_at = datetime('now') WHERE id = ?").run(ref, id);
        }
      } catch (e) {
        fail(`No se pudo guardar el video: ${(e as Error).message}`);
      }
      if (!silentPreview) rmSync(path, { force: true });
      done();
    };
    child.on('error', (e) => void finish(false, e.message));
    child.on('close', (code) => void finish(code === 0 && existsSync(join(OUT, name)), `El render falló (código ${code}). ${err.trim().split('\n').slice(-2).join(' ')}`));
  });
}

/** A restart kills the running render: leave those rows in error so they can be retried. */
export function recoverInterrupted(): void {
  db.prepare("UPDATE video_specs SET status = 'error', detail = 'Se interrumpió al reiniciar el servidor. Vuelve a intentarlo.' WHERE status IN ('rendering', 'previewing')").run();
}

/** Path of the local preview mp4 (for the player). */
export function previewFile(id: number): string {
  const cur = get(id);
  const path = cur.preview_file && cur.status === 'review' && OUT ? resolve(OUT, cur.preview_file) : '';
  if (!path || !path.startsWith(OUT + sep) || !existsSync(path)) throw new AccessError('La versión previa todavía no está lista.');
  return path;
}

// ---- assets (images/logos of each project in the taller) ----

export function assets(): { path: string; project: string }[] {
  if (!PROJECTS || !existsSync(PROJECTS)) return [];
  const out: { path: string; project: string }[] = [];
  for (const project of readdirSync(PROJECTS)) {
    for (const sub of ['imagenes', 'marca', 'mascota', 'capturas']) {
      const dir = join(PROJECTS, project, sub);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) if (IMAGE.test(f)) out.push({ path: `proyectos/${project}/${sub}/${f}`, project });
    }
  }
  return out;
}

/** Absolute path of an asset, only inside public/proyectos. */
export function assetFile(rel: string): string {
  const path = TALLER ? resolve(TALLER, 'public', rel) : '';
  if (!path || !path.startsWith(PROJECTS + sep) || !IMAGE.test(path) || !existsSync(path) || !statSync(path).isFile()) throw new AccessError('Esa imagen no existe.');
  return path;
}
