import { db } from '../../database/connection.js';
import { AccessError } from '../../models/permissions.model.js';
import { promoModel } from '../../models/promo.model.js';
import type { PromoItem } from '../../entities/promo.entity.js';
import { createPromo, type CreateInput } from '../promo/promo.service.js';
import { publicUrl, readFile } from '../promo/promo-storage.js';
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
export const mediaAccess: MediaAccess = { url: resolveMedia, read: (ref) => readFile(ref) };

const PREFERRED = { video: ['vertical', 'landscape'], image: ['square', 'story', 'landscape'] } as const;

function bestFile(item: PromoItem): { file: string; poster: string } | null {
  for (const fmt of PREFERRED[item.media]) {
    const f = item.files[fmt];
    if (f?.file) return { file: f.file, poster: f.poster || (item.media === 'image' ? f.file : '') };
  }
  return null;
}

/** Material ready to publish: what the administrator approved. */
export function approvedAssets() {
  return promoModel
    .list()
    .filter((i) => i.status === 'approved')
    .flatMap((i) => {
      const best = bestFile(i);
      return best ? [{ id: i.id, media: i.media, title: i.title, caption: i.caption, url: resolveMedia(best.file), poster: resolveMedia(best.poster) }] : [];
    });
}

export function postFromAsset(userId: number | null, promoId: number, extra: { keywords?: string[]; hashtags?: string[] } = {}) {
  const item = promoModel.get(promoId);
  if (!item || item.status !== 'approved') throw new AccessError('Ese material todavía no está aprobado.');
  const best = bestFile(item);
  if (!best) throw new AccessError('Ese material no tiene archivo.');
  const post: NewPost = {
    promoItemId: item.id,
    mediaType: item.media,
    mediaRef: best.file,
    thumbnailRef: best.poster,
    title: item.title || 'Sin título',
    description: item.caption,
    hashtags: normalizeHashtags(extra.hashtags ?? [], 30),
    keywords: extra.keywords ?? [],
  };
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
  const wanted = Math.max(1, Math.min(3, Math.trunc(input.count ?? 1)));
  const cap = generationCap();
  const used = generatedThisMonth();
  if (used + wanted > cap) throw new AccessError(`Con esto pasarías el tope de ${cap} piezas al mes (llevas ${used}). Súbelo en los ajustes si lo necesitas.`);
  return createPromo(adminId, input);
}
