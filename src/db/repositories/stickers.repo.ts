import { db } from '../pool.js';
import type { Sticker } from '../../types/index.js';

/** Label-only view of a sticker - everything that only needs to pick/list stickers uses this
 *  instead of `SELECT *`, so it never drags every sticker's image BLOB into memory just to read
 *  the names (buildSystemPrompt runs this on every single message). */
export interface StickerLabelRow {
  id: number;
  label: string;
}

/** "Buenos Días 😺!" -> "buenos_dias" - strips accents, emoji and punctuation, lowercases, and
 *  collapses whitespace/dashes to a single underscore. Every label is stored in this form, and
 *  every lookup compares in this form on BOTH sides (see findLabelMatch), so a human typing it
 *  either way and the AI's send_sticker call always agree - including labels saved before this
 *  normalization stripped emoji/punctuation. */
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

export function normalizeStickerLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '') // strip the accent marks NFD split off (á -> a + U+0301, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ') // emoji, punctuation, quotes -> separators
    .trim()
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Same as normalizeStickerLabel but also drops the underscores - "buenas_noches", "buenasnoches"
 *  and "buenas noches" all compare equal, for the fuzzy/keyword matching below. */
function squash(raw: string): string {
  return normalizeStickerLabel(raw).replace(/_/g, '');
}

function pickRandom<T>(rows: T[]): T | undefined {
  return rows.length ? rows[Math.floor(Math.random() * rows.length)] : undefined;
}

/** True for a static or animated WebP (RIFF....WEBP) - the only sticker format WhatsApp accepts
 *  back through Baileys' `{ sticker: buffer }`. The newer Lottie-based animated stickers
 *  (mimetype application/was) are a zip, not WebP, and can't be resent as-is. */
export function isWebp(data: Buffer): boolean {
  return data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
}

export const stickersRepo = {
  getById(id: number): Sticker | undefined {
    return db.prepare('SELECT * FROM stickers WHERE id = ?').get(id) as Sticker | undefined;
  },

  /** Saves a freshly-received sticker with no label yet - see getPendingFor(). */
  createPending(createdBy: number, data: Buffer, mimetype: string): Sticker {
    const info = db
      .prepare('INSERT INTO stickers (label, data, mimetype, created_by) VALUES (NULL, ?, ?, ?)')
      .run(data, mimetype, createdBy);
    return this.getById(Number(info.lastInsertRowid))!;
  },

  /** An already-saved sticker (labeled or still pending) with these exact bytes, if any - so the
   *  admin re-sending the same sticker doesn't create a duplicate. */
  findByData(data: Buffer): StickerLabelRow | { id: number; label: null } | undefined {
    return db.prepare('SELECT id, label FROM stickers WHERE data = ? LIMIT 1').get(data) as
      | StickerLabelRow
      | { id: number; label: null }
      | undefined;
  },

  /** The OLDEST sticker still waiting for a label from this admin, if any - FIFO, so when several
   *  are sent in a row the names typed afterwards are applied in the same order (see
   *  bot-manager.ts's "next plain-text message names it" flow). Ordered by id, not created_at:
   *  datetime('now') only has 1-second resolution, so a quick burst of stickers would tie. */
  getPendingFor(createdBy: number): Sticker | undefined {
    return db
      .prepare('SELECT * FROM stickers WHERE created_by = ? AND label IS NULL ORDER BY id ASC LIMIT 1')
      .get(createdBy) as Sticker | undefined;
  },

  countPendingFor(createdBy: number): number {
    return (
      db.prepare('SELECT COUNT(*) AS n FROM stickers WHERE created_by = ? AND label IS NULL').get(createdBy) as {
        n: number;
      }
    ).n;
  },

  setLabel(id: number, label: string): void {
    db.prepare('UPDATE stickers SET label = ? WHERE id = ?').run(label, id);
  },

  /** Only labeled stickers - a pending, not-yet-named one is never usable/listable. No BLOBs. */
  listLabels(): StickerLabelRow[] {
    return db
      .prepare('SELECT id, label FROM stickers WHERE label IS NOT NULL ORDER BY label, id')
      .all() as StickerLabelRow[];
  },

  /** Distinct labels for the system prompt, in their normalized form (two stickers saved under
   *  the same name show once, and a legacy "Buenas Noches 🌙" shows as the "buenas_noches" the
   *  model should pass back). A legacy emoji-only label normalizes to "" and can never be asked
   *  for, so it's left out instead of advertised - see scripts/audit-stickers.ts. */
  distinctLabels(): string[] {
    return [...new Set(this.listLabels().map((r) => normalizeStickerLabel(r.label)).filter(Boolean))];
  },

  /**
   * Resolves a label the AI (or the admin) typed to the stored stickers it refers to:
   *   1. exact match after normalizing both sides;
   *   2. otherwise, labels that contain the query or are contained by it (ignoring underscores) -
   *      but only if that narrows it down to ONE distinct label, never a guess between several.
   * Returns every sticker under the resolved label (several = variety, caller picks one).
   */
  findLabelMatch(query: string): StickerLabelRow[] {
    const rows = this.listLabels();
    const q = normalizeStickerLabel(query);
    if (!q) return [];
    const exact = rows.filter((r) => normalizeStickerLabel(r.label) === q);
    if (exact.length) return exact;

    const qs = squash(query);
    const fuzzy = rows.filter((r) => {
      const ls = squash(r.label);
      return ls.length > 0 && (ls.includes(qs) || (ls.length >= 4 && qs.includes(ls)));
    });
    const labels = new Set(fuzzy.map((r) => normalizeStickerLabel(r.label)));
    return labels.size === 1 ? fuzzy : [];
  },

  /** A random sticker under the label `query` resolves to (see findLabelMatch), with its data. */
  getByLabel(query: string): Sticker | undefined {
    const row = pickRandom(this.findLabelMatch(query));
    return row ? this.getById(row.id) : undefined;
  },

  /**
   * Best-effort lookup for automatic sends that never go through the AI's own judgment (the
   * celebration on complete_todo/checkin_routine, the "buenas noches" close of day) - a label
   * matches if it contains any of the keywords (accents/underscores/spaces ignored). Picks one at
   * random when several match, so having more than one celebration sticker just adds variety.
   */
  findByKeywords(keywords: string[]): Sticker | undefined {
    const keys = keywords.map(squash).filter(Boolean);
    if (keys.length === 0) return undefined;
    const row = pickRandom(this.listLabels().filter((r) => keys.some((k) => squash(r.label).includes(k))));
    return row ? this.getById(row.id) : undefined;
  },

  delete(id: number): void {
    db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
  },
};
