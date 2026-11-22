import { db } from '../../../database/connection.js';
import { AccessError } from '../../../models/permissions.model.js';
import { deleteItemFiles, publicUrl, putFile } from '../../promo/promo-storage.js';
import { publisherStore } from '../publisher.store.js';
import { studioStore } from '../studio/studio.store.js';
import { ASPECTS, MAX_VIDEO_SECONDS, imageProviders, pickProvider, videoProviders, type Aspect, type Generated } from './generation.providers.js';

/**
 * Generates images and videos with the brand profile, keeps them as reusable assets (they appear
 * in the publisher's «material» list next to the approved designs) and counts what they cost.
 * Generation runs in the background: the request answers at once with a «working» asset and the
 * panel polls until it is «ready». Videos run one at a time.
 */
export interface AssetRow {
  id: number;
  media: 'image' | 'video';
  provider: string;
  simulated: number;
  prompt: string;
  aspect: Aspect;
  seconds: number;
  title: string;
  caption: string;
  status: 'working' | 'ready' | 'error';
  detail: string;
  file_ref: string;
  poster_ref: string;
  cost_cents: number;
  created_by: number | null;
  created_at: string;
}

const DEFAULT_COST_CAP_CENTS = 2000; // USD 20 per month, until the administrator changes it

// ---------- budget: pieces (shared with the rest of the material) + money ----------

export function costCapCents(): number {
  const n = Number(publisherStore.getSetting('cost_cap_cents'));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_COST_CAP_CENTS;
}

export function setCostCapCents(n: number): void {
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new AccessError('El tope de gasto no es válido.');
  publisherStore.setSetting('cost_cap_cents', String(Math.trunc(n)));
}

export const spentThisMonthCents = (): number =>
  (db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) AS n FROM publisher_assets WHERE status != 'error' AND created_at >= date('now', 'start of month')`).get() as { n: number }).n;

/** Non-simulated assets this month: they count against the shared monthly cap of pieces. */
export const paidAssetsThisMonth = (): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM publisher_assets WHERE simulated = 0 AND status != 'error' AND created_at >= date('now', 'start of month')`).get() as { n: number }).n;

export function usageSummary() {
  const rows = db
    .prepare(
      `SELECT media, provider, simulated, COUNT(*) AS pieces, COALESCE(SUM(cost_cents), 0) AS cents
         FROM publisher_assets WHERE status != 'error' AND created_at >= date('now', 'start of month') GROUP BY media, provider, simulated`,
    )
    .all() as { media: string; provider: string; simulated: number; pieces: number; cents: number }[];
  return { costCapCents: costCapCents(), spentCents: spentThisMonthCents(), byProvider: rows.map((r) => ({ ...r, simulated: !!r.simulated })) };
}

// ---------- reading ----------

export function assetView(a: AssetRow) {
  return {
    id: a.id,
    media: a.media,
    provider: a.provider,
    simulated: !!a.simulated,
    prompt: a.prompt,
    aspect: a.aspect,
    seconds: a.seconds,
    title: a.title,
    status: a.status,
    detail: a.detail,
    url: publicUrl(a.file_ref),
    poster: publicUrl(a.poster_ref),
    costCents: a.cost_cents,
    createdAt: `${a.created_at.replace(' ', 'T')}Z`,
  };
}

export const getAsset = (id: number) => db.prepare('SELECT * FROM publisher_assets WHERE id = ?').get(id) as AssetRow | undefined;
export const listAssets = () => (db.prepare('SELECT * FROM publisher_assets ORDER BY id DESC LIMIT 100').all() as AssetRow[]).map(assetView);
export const readyAssets = () => db.prepare(`SELECT * FROM publisher_assets WHERE status = 'ready' ORDER BY id DESC`).all() as AssetRow[];

export function generationStatus() {
  const image = pickProvider(imageProviders, publisherStore.getSetting('image_provider'));
  const video = pickProvider(videoProviders, publisherStore.getSetting('video_provider'));
  const describe = (all: typeof imageProviders | typeof videoProviders, active: string) =>
    Object.values(all).map((p) => ({ key: p.key, label: p.label, simulated: p.simulated, configured: p.configured(), envVars: p.envVars, active: p.key === active }));
  return {
    image: describe(imageProviders, image.key),
    video: describe(videoProviders, video.key),
    maxVideoSeconds: MAX_VIDEO_SECONDS,
    usage: usageSummary(),
  };
}

export function chooseProviders(input: { image?: string; video?: string }): void {
  if (input.image !== undefined) {
    if (!imageProviders[input.image]) throw new AccessError('Ese proveedor de imágenes no existe.');
    publisherStore.setSetting('image_provider', input.image);
  }
  if (input.video !== undefined) {
    if (!videoProviders[input.video]) throw new AccessError('Ese proveedor de videos no existe.');
    publisherStore.setSetting('video_provider', input.video);
  }
}

// ---------- making ----------

/** Brand profile → the text sent to the model (it describes the picture; the model never writes words). */
function brandPrompt(subject: string): string {
  const brand = publisherStore.getBrand();
  const identity = studioStore.getIdentity();
  const parts = [subject.trim()];
  if (identity.style) parts.push(`Visual style: ${identity.style}.`);
  parts.push(`Brand colors ${identity.colors.primary}, ${identity.colors.accent} and ${identity.colors.dark}.`);
  if (brand.tone) parts.push(`Mood: ${brand.tone}.`);
  parts.push('No text, no letters, no numbers, no watermark, no logo.');
  return parts.join(' ');
}

function checkBudget(estimateCents: number, simulated: boolean): void {
  if (simulated) return;
  const spent = spentThisMonthCents();
  const cap = costCapCents();
  if (spent + estimateCents > cap) {
    throw new AccessError(`Esto costaría ~USD ${(estimateCents / 100).toFixed(2)} y pasarías el tope de USD ${(cap / 100).toFixed(2)} al mes (llevas USD ${(spent / 100).toFixed(2)}). Súbelo en los ajustes si lo necesitas.`);
  }
}

const insert = (a: Pick<AssetRow, 'media' | 'provider' | 'simulated' | 'prompt' | 'aspect' | 'seconds' | 'title' | 'cost_cents' | 'created_by'>): number =>
  Number(
    db
      .prepare('INSERT INTO publisher_assets (media, provider, simulated, prompt, aspect, seconds, title, cost_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.media, a.provider, a.simulated, a.prompt, a.aspect, a.seconds, a.title, a.cost_cents, a.created_by).lastInsertRowid,
  );

let videoChain: Promise<unknown> = Promise.resolve();

async function finish(id: number, work: () => Promise<{ file: Generated; poster?: Generated }>): Promise<void> {
  try {
    const { file, poster } = await work();
    const fileRef = await putFile(`gen-${id}`, `media.${file.ext}`, file.data, file.mime);
    const posterRef = poster ? await putFile(`gen-${id}`, `poster.${poster.ext}`, poster.data, poster.mime) : '';
    db.prepare(`UPDATE publisher_assets SET status = 'ready', file_ref = ?, poster_ref = ? WHERE id = ?`).run(fileRef, posterRef, id);
  } catch (err) {
    // A failed call is not charged to the monthly budget.
    db.prepare(`UPDATE publisher_assets SET status = 'error', detail = ?, cost_cents = 0 WHERE id = ?`).run(err instanceof Error ? err.message.slice(0, 300) : 'Falló la generación.', id);
  }
}

const cleanPrompt = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim().slice(0, 600) : '';
  if (s.length < 3) throw new AccessError('Cuéntame qué quieres ver en la pieza.');
  return s;
};
const cleanAspect = (v: unknown): Aspect => (ASPECTS.includes(v as Aspect) ? (v as Aspect) : 'square');
const titleOf = (title: unknown, prompt: string) => (typeof title === 'string' && title.trim() ? title.trim().slice(0, 100) : prompt.slice(0, 60));

export interface GenerateInput { prompt: unknown; aspect?: unknown; seconds?: unknown; title?: unknown }

export function generateImage(adminId: number | null, input: GenerateInput) {
  const prompt = cleanPrompt(input.prompt);
  const aspect = cleanAspect(input.aspect);
  const provider = pickProvider(imageProviders, publisherStore.getSetting('image_provider'));
  checkBudget(provider.costCents(), provider.simulated);
  const id = insert({ media: 'image', provider: provider.key, simulated: provider.simulated ? 1 : 0, prompt, aspect, seconds: 0, title: titleOf(input.title, prompt), cost_cents: provider.costCents(), created_by: adminId });
  void finish(id, async () => ({ file: await provider.generate({ prompt: brandPrompt(prompt), aspect, colors: studioStore.getIdentity().colors }) }));
  return assetView(getAsset(id)!);
}

export function generateVideo(adminId: number | null, input: GenerateInput) {
  const prompt = cleanPrompt(input.prompt);
  const aspect = cleanAspect(input.aspect === undefined ? 'portrait' : input.aspect);
  const seconds = Math.max(2, Math.min(MAX_VIDEO_SECONDS, Math.trunc(Number(input.seconds)) || 5));
  const provider = pickProvider(videoProviders, publisherStore.getSetting('video_provider'));
  const cost = provider.costCents(seconds);
  checkBudget(cost, provider.simulated);
  const id = insert({ media: 'video', provider: provider.key, simulated: provider.simulated ? 1 : 0, prompt, aspect, seconds, title: titleOf(input.title, prompt), cost_cents: cost, created_by: adminId });
  videoChain = videoChain.then(() => finish(id, async () => {
    const out = await provider.generate({ prompt: brandPrompt(prompt), aspect, seconds, colors: studioStore.getIdentity().colors });
    return { file: out, poster: out.poster };
  }));
  return assetView(getAsset(id)!);
}

/** After a restart, whatever was half-made cannot continue: it is marked as failed (and not charged). */
export function failInterruptedAssets(): void {
  db.prepare(`UPDATE publisher_assets SET status = 'error', detail = 'Se interrumpió al reiniciar el servidor.', cost_cents = 0 WHERE status = 'working'`).run();
}

export async function deleteAsset(id: number): Promise<void> {
  const a = getAsset(id);
  if (!a) throw new AccessError('Esa pieza ya no existe.');
  const used = db.prepare(`SELECT COUNT(*) AS n FROM publisher_posts WHERE media_ref = ?`).get(a.file_ref) as { n: number };
  if (a.file_ref && used.n > 0) throw new AccessError('Esa pieza está en la cola de publicaciones: elimina primero la publicación.');
  db.prepare('DELETE FROM publisher_assets WHERE id = ?').run(id);
  await deleteItemFiles(`gen-${id}`);
}
