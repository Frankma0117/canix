import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { db } from '../../database/connection.js';
import { AccessError } from '../../models/permissions.model.js';
import { putFile, publicUrl, deleteItemFiles } from '../promo/promo-storage.js';
import { canixTemplate, parseSpec, type VideoSpec } from './spec.js';

/**
 * "Taller" Remotion videos (callouts + full-body mascot) managed from the admin panel.
 * The taller lives on the server (VIDEO_TALLER_DIR, e.g. /opt/videos/taller); without it
 * (local dev) everything but rendering works and the panel says so. Renders run one at a time,
 * low priority (nice/ionice, 1 thread). On approval the mp4 goes to Spaces and is deleted from disk.
 */

export type VideoStatus = 'draft' | 'rendering' | 'review' | 'approved' | 'error';
export interface VideoRow {
  id: number;
  title: string;
  spec: VideoSpec;
  status: VideoStatus;
  detail: string;
  file: string | null;
  url: string;
  created_at: string;
  updated_at: string;
}
type Raw = Omit<VideoRow, 'spec' | 'url'> & { spec: string };

const TALLER = (process.env.VIDEO_TALLER_DIR ?? '').trim();
const OUT = TALLER ? resolve(TALLER, '..', 'out') : '';
const TMP = TALLER ? resolve(TALLER, '..', 'tmp') : '';
const PROJECTS = TALLER ? join(TALLER, 'public', 'proyectos') : '';
const IMAGE = /\.(png|jpe?g|webp)$/i;

export const available = () => !!TALLER && existsSync(join(TALLER, 'tools', 'env.sh'));

function toRow(r: Raw): VideoRow {
  const approved = r.status === 'approved' && r.file;
  return { ...r, spec: JSON.parse(r.spec) as VideoSpec, url: approved ? publicUrl(r.file) : '' };
}

export function list(): VideoRow[] {
  return (db.prepare('SELECT * FROM video_specs ORDER BY id DESC LIMIT 200').all() as Raw[]).map(toRow);
}

function get(id: number): Raw {
  const r = db.prepare('SELECT * FROM video_specs WHERE id = ?').get(id) as Raw | undefined;
  if (!r) throw new AccessError('Ese video no existe.');
  return r;
}

export function create(userId: number, title: string, spec?: unknown): VideoRow[] {
  const clean = parseSpec(spec ?? canixTemplate());
  db.prepare('INSERT INTO video_specs (title, spec, created_by) VALUES (?, ?, ?)').run(title.trim() || clean.intro.title, JSON.stringify(clean), userId);
  return list();
}

export function update(id: number, title: string, spec: unknown): VideoRow[] {
  const cur = get(id);
  if (cur.status === 'rendering') throw new AccessError('Espera a que termine el render para editarlo.');
  if (cur.status === 'approved') throw new AccessError('Este video ya está aprobado; duplícalo para hacer otra versión.');
  const clean = parseSpec(spec);
  // Editing a finished video sends it back to draft: the file no longer matches the spec.
  if (cur.status === 'review' && cur.file) rmSync(join(OUT, cur.file), { force: true });
  db.prepare("UPDATE video_specs SET title = ?, spec = ?, status = 'draft', file = NULL, detail = '', updated_at = datetime('now') WHERE id = ?").run(title.trim() || clean.intro.title, JSON.stringify(clean), id);
  return list();
}

export async function remove(id: number): Promise<void> {
  const cur = get(id);
  if (cur.status === 'rendering') throw new AccessError('Espera a que termine el render para borrarlo.');
  if (cur.status === 'review' && cur.file && OUT) rmSync(join(OUT, cur.file), { force: true });
  if (cur.status === 'approved') await deleteItemFiles(`studio-${id}`);
  db.prepare('DELETE FROM video_specs WHERE id = ?').run(id);
}

// ---- render (one at a time) ----

let chain: Promise<void> = Promise.resolve();

export function render(id: number): VideoRow[] {
  if (!available()) throw new AccessError('El taller de video no está disponible en este servidor.');
  const cur = get(id);
  if (cur.status === 'rendering') throw new AccessError('Ya se está generando.');
  if (cur.status === 'approved') throw new AccessError('Este video ya está aprobado; duplícalo para hacer otra versión.');
  if (cur.status === 'review' && cur.file) rmSync(join(OUT, cur.file), { force: true });
  db.prepare("UPDATE video_specs SET status = 'rendering', file = NULL, detail = 'En cola…', updated_at = datetime('now') WHERE id = ?").run(id);
  chain = chain.then(() => runRender(id)).catch(() => undefined);
  return list();
}

function runRender(id: number): Promise<void> {
  const row = db.prepare('SELECT spec FROM video_specs WHERE id = ?').get(id) as { spec: string } | undefined;
  if (!row) return Promise.resolve();
  const props = join(TMP, `studio-${id}.json`);
  const name = `studio-${id}-${Date.now()}.mp4`;
  writeFileSync(props, row.spec);
  db.prepare("UPDATE video_specs SET detail = 'Generando el video…' WHERE id = ?").run(id);
  const cmd = `source tools/env.sh && nice -n 19 ionice -c3 npx remotion render src/index.ts Promo "${join(OUT, name)}" --props="${props}" --concurrency=1 --log=error`;
  return new Promise((done) => {
    const child = spawn('bash', ['-c', cmd], { cwd: TALLER, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-600)));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    let ended = false;
    const finish = (ok: boolean, why: string) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      rmSync(props, { force: true });
      if (ok) db.prepare("UPDATE video_specs SET status = 'review', file = ?, detail = '', updated_at = datetime('now') WHERE id = ?").run(name, id);
      else db.prepare("UPDATE video_specs SET status = 'error', detail = ?, updated_at = datetime('now') WHERE id = ?").run(why.slice(0, 300) || 'No se pudo generar el video.', id);
      done();
    };
    child.on('error', (e) => finish(false, e.message));
    child.on('close', (code) => finish(code === 0 && existsSync(join(OUT, name)), `El render falló (código ${code}). ${err.trim().split('\n').slice(-2).join(' ')}`));
  });
}

/** A restart kills the running render: leave those rows in error so they can be retried. */
export function recoverInterrupted(): void {
  db.prepare("UPDATE video_specs SET status = 'error', detail = 'Se interrumpió al reiniciar el servidor. Vuelve a generarlo.' WHERE status = 'rendering'").run();
}

/** Path of the rendered mp4 waiting for review (for the player and the download). */
export function reviewFile(id: number): string {
  const cur = get(id);
  const path = cur.file && cur.status === 'review' && OUT ? resolve(OUT, cur.file) : '';
  if (!path || !path.startsWith(OUT + sep) || !existsSync(path)) throw new AccessError('Ese video todavía no está listo.');
  return path;
}

/** Approve: upload to Spaces, then free the server's disk. Reject: discard the file, keep the spec. */
export async function review(id: number, approve: boolean): Promise<VideoRow[]> {
  const path = reviewFile(id);
  if (approve) {
    const ref = await putFile(`studio-${id}`, 'video.mp4', readFileSync(path), 'video/mp4');
    db.prepare("UPDATE video_specs SET status = 'approved', file = ?, detail = '', updated_at = datetime('now') WHERE id = ?").run(ref, id);
  } else {
    db.prepare("UPDATE video_specs SET status = 'draft', file = NULL, detail = 'Descartado; ajústalo y genera otra versión.', updated_at = datetime('now') WHERE id = ?").run(id);
  }
  rmSync(path, { force: true });
  return list();
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
