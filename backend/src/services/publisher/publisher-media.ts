import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { AccessError } from '../../models/permissions.model.js';
import { promoModel } from '../../models/promo.model.js';
import type { PromoItem } from '../../entities/promo.entity.js';
import { createPromo, type CreateInput } from '../promo/promo.service.js';
import { deleteItemFiles, publicUrl, putFile, readFile } from '../promo/promo-storage.js';
import { studioStore } from './studio/studio.store.js';
import type { MediaAccess } from './publisher.types.js';
import { createPost, type NewPost } from './publisher.service.js';
import { publisherStore } from './publisher.store.js';
import { normalizeHashtags } from './publisher-seo.js';

/**
 * The only file of the publisher that knows where the media comes from. In Canix it comes from the
 * advertising module (services/promo/: videos and images generated here and approved by the
 * administrator). In another project, replace the three functions below with that project's own
 * generator and storage - the queue, the SEO and the panel don't change.
 */

/** A stored reference → a URL a platform (or the browser) can fetch. */
export const resolveMedia = (ref: string): string => publicUrl(ref);

/** What the publisher uses to reach the media: its URL, or its bytes (for platforms that need an upload). */
export const mediaAccess: MediaAccess = {
  // Platforms download from outside: local files need the public address of the server.
  url: (ref) => {
    const url = resolveMedia(ref);
    return url.startsWith('/') ? `${env.panelUrl.replace(/\/$/, '')}${url}` : url;
  },
  read: (ref) => readFile(ref),
};

const PREFERRED = { video: ['vertical', 'landscape'], image: ['square', 'story', 'landscape'] } as const;

function bestFile(item: PromoItem): { file: string; poster: string } | null {
  for (const fmt of PREFERRED[item.media]) {
    const f = item.files[fmt];
    if (f?.file) return { file: f.file, poster: f.poster || (item.media === 'image' ? f.file : '') };
  }
  return null;
}

/** Material ready to publish: what the administrator approved (advertising module → «p12», brand studio → «d5»). */
export function approvedAssets() {
  const promo = promoModel
    .list()
    .filter((i) => i.status === 'approved')
    .flatMap((i) => {
      const best = bestFile(i);
      return best ? [{ id: `p${i.id}`, source: 'promo' as const, media: i.media, title: i.title, caption: i.caption, url: resolveMedia(best.file), poster: resolveMedia(best.poster) }] : [];
    });
  const designs = studioStore
    .approved()
    .filter((d) => d.kind !== 'logo' && d.kind !== 'profile' && d.kind !== 'cover')
    .map((d) => ({ id: `d${d.id}`, source: 'studio' as const, media: 'image' as const, title: d.title, caption: d.caption, url: resolveMedia(d.file_ref), poster: resolveMedia(d.file_ref) }));
  return [...designs, ...promo];
}

export function postFromAsset(userId: number | null, assetId: string, extra: { keywords?: string[]; hashtags?: string[] } = {}) {
  const m = /^([pd])(\d+)$/.exec(assetId);
  if (!m) throw new AccessError('Elige el video o la imagen que quieres publicar.');
  const id = Number(m[2]);
  const common = { keywords: extra.keywords ?? [], hashtags: normalizeHashtags(extra.hashtags ?? [], 30) };
  if (m[1] === 'd') {
    const d = studioStore.get(id);
    if (!d || d.status !== 'approved' || !d.file_ref) throw new AccessError('Ese diseño todavía no está aprobado.');
    return createPost(userId, { mediaType: 'image', mediaRef: d.file_ref, thumbnailRef: d.file_ref, title: d.title || 'Sin título', description: d.caption, ...common });
  }
  const item = promoModel.get(id);
  if (!item || item.status !== 'approved') throw new AccessError('Ese material todavía no está aprobado.');
  const best = bestFile(item);
  if (!best) throw new AccessError('Ese material no tiene archivo.');
  const post: NewPost = { promoItemId: item.id, mediaType: item.media, mediaRef: best.file, thumbnailRef: best.poster, title: item.title || 'Sin título', description: item.caption, ...common };
  return createPost(userId, post);
}

// ---------- generation (costs money: monthly cap per project) ----------

const DEFAULT_CAP = 30;

export function generationCap(): number {
  const n = Number(publisherStore.getSetting('generation_cap'));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_CAP;
}

export function setGenerationCap(n: number): void {
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new AccessError('El tope mensual no es válido.');
  publisherStore.setSetting('generation_cap', String(Math.trunc(n)));
}

/** Pieces generated since the first day of this month (UTC). */
export function generatedThisMonth(): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM promo_items WHERE created_at >= date('now', 'start of month')`).get() as { n: number };
  return r.n;
}

/** Asks the generator for new material, unless the project's monthly cap would be exceeded. */
export function generateAssets(adminId: number, input: CreateInput) {
  ensureBudget(Math.max(1, Math.min(3, Math.trunc(input.count ?? 1))));
  return createPromo(adminId, input);
}

// ---------- files of the brand studio (same storage as the rest of the material) ----------

/** Stores a studio file (Spaces or the local disk) and returns its reference. */
export const storeStudioFile = (designId: number, name: string, data: Buffer, mime: string): Promise<string> => putFile(`studio-${designId}`, name, data, mime);
export const readStudioFile = (ref: string): Promise<Buffer | null> => readFile(ref);
export const deleteStudioFiles = (designId: number): Promise<void> => deleteItemFiles(`studio-${designId}`);

/** Pieces that cost money count against the same monthly cap: videos/images of the advertising module + AI art of the studio. */
export function ensureBudget(wanted: number): void {
  const cap = generationCap();
  const used = usedThisMonth();
  if (used + wanted > cap) throw new AccessError(`Con esto pasarías el tope de ${cap} piezas al mes (llevas ${used}). Súbelo en los ajustes si lo necesitas.`);
}

export const usedThisMonth = (): number => generatedThisMonth() + studioStore.aiThisMonth();
