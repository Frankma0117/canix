import { createHash } from 'node:crypto';
import { db } from '../db/pool.js';
import { garmentsRepo } from '../db/repositories/garments.repo.js';
import { spacesStorageService } from './storage/spaces-storage.service.js';
import { dominantColor } from './image/dominant-color.js';
import { buildShortDescription } from './description.js';
import { env } from '../config/env.js';
import { sleep } from '../util/human-delay.js';
import type { Garment } from '../types/index.js';

/**
 * Keeps the wardrobe's data usable, in the background, with no AI and at no cost:
 *   - reads each garment's real color from its own photo (image/dominant-color.ts) when the
 *     classifier left it empty or "multicolor" - a color a person typed is never touched;
 *   - fingerprints each photo, and removes a garment whose photo is byte-for-byte the same as
 *     another one of that person's (the same PDF imported twice doubled a whole wardrobe).
 * Each garment is looked at once (color_checked_at). Runs a small batch at a time so it never
 * competes with the bot for the machine.
 */
const BATCH = 40;
const BETWEEN_GARMENTS_MS = 250;
let running = false;

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function parseArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

async function checkOne(g: Garment): Promise<'colored' | 'checked' | 'unreachable'> {
  // The thumbnail is the same picture, a fraction of the bytes - plenty to read a color from.
  const image = await fetchImage(g.thumbnail_url ?? g.image_url);
  if (!image) return 'unreachable';

  const hash = createHash('sha1').update(image).digest('hex');
  const needsColor = !g.color || g.color === 'multicolor';
  const reading = needsColor ? await dominantColor(image) : null;

  if (reading && reading.share >= 0.3) {
    const short = buildShortDescription({ type: g.type, category: g.category, color: reading.color, sleeves: g.sleeves });
    db.prepare(
      `UPDATE garments SET color = ?, secondary_colors = COALESCE(?, secondary_colors), short_description = ?, image_hash = ?,
         color_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).run(reading.color, reading.secondary ? JSON.stringify([reading.secondary]) : null, short, hash, g.id);
    return 'colored';
  }
  db.prepare(`UPDATE garments SET image_hash = ?, color_checked_at = datetime('now') WHERE id = ?`).run(hash, g.id);
  return 'checked';
}

/** How much a garment's row is worth keeping over its duplicate: favorite, used in a saved outfit, more filled in. */
function worth(g: Garment): number {
  const inOutfits = (db.prepare('SELECT COUNT(*) AS c FROM outfit_garments WHERE garment_id = ?').get(g.id) as { c: number }).c;
  const filled = [g.color, g.material, g.fit, g.pattern, g.formality, g.notes, g.brand].filter(Boolean).length;
  return (g.favorite ? 100 : 0) + inOutfits * 50 + filled + (parseArray(g.style)?.length ? 1 : 0);
}

/** Removes garments whose photo is identical to another's (same person). Returns storage keys to delete. */
function removeExactDuplicates(): { removed: number; storageKeys: string[] } {
  const groups = db
    .prepare(`SELECT user_id, image_hash FROM garments WHERE is_active = 1 AND image_hash IS NOT NULL GROUP BY user_id, image_hash HAVING COUNT(*) > 1`)
    .all() as { user_id: number; image_hash: string }[];
  const storageKeys: string[] = [];
  let removed = 0;
  for (const group of groups) {
    const same = db.prepare('SELECT * FROM garments WHERE user_id = ? AND image_hash = ? AND is_active = 1').all(group.user_id, group.image_hash) as Garment[];
    const [, ...losers] = same.sort((a, b) => worth(b) - worth(a) || a.id - b.id);
    for (const loser of losers) {
      const gone = garmentsRepo.remove(group.user_id, loser.id);
      if (!gone) continue;
      storageKeys.push(gone.storageKey);
      if (gone.thumbnailKey) storageKeys.push(gone.thumbnailKey);
      removed++;
    }
  }
  return { removed, storageKeys };
}

/** One pass over the garments not looked at yet. Safe to call as often as wanted; never throws. */
export async function wardrobeUpkeep(): Promise<void> {
  if (!env.fashion.enabled || running) return;
  running = true;
  try {
    const pending = db.prepare('SELECT * FROM garments WHERE is_active = 1 AND color_checked_at IS NULL ORDER BY id LIMIT ?').all(BATCH) as Garment[];
    if (pending.length === 0) return;

    let colored = 0;
    let unreachable = 0;
    for (const g of pending) {
      const outcome = await checkOne(g).catch(() => 'unreachable' as const);
      if (outcome === 'colored') colored++;
      if (outcome === 'unreachable') {
        unreachable++;
        // not retried forever: a photo that's gone can't be read tomorrow either
        db.prepare(`UPDATE garments SET color_checked_at = datetime('now') WHERE id = ?`).run(g.id);
      }
      await sleep(BETWEEN_GARMENTS_MS);
    }

    const { removed, storageKeys } = removeExactDuplicates();
    if (storageKeys.length) await spacesStorageService.delete(storageKeys).catch(() => {});
    console.log(
      '[FASHION] Mantenimiento del armario: %d prenda(s) revisadas, %d con color detectado, %d foto(s) no disponibles, %d duplicada(s) exactas eliminadas.',
      pending.length,
      colored,
      unreachable,
      removed,
    );
  } catch (err) {
    console.error('[FASHION] Mantenimiento del armario falló:', (err as Error).message);
  } finally {
    running = false;
  }
}
