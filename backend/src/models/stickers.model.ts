import { db } from '../database/connection.js';
import type { Sticker } from '../entities/index.js';

/** Label-only view of a sticker - everything that only needs to pick/list stickers uses this
 *  instead of `SELECT *`, so it never drags every sticker's image BLOB into memory just to read
 *  the names (buildSystemPrompt runs this on every single message). */
export interface StickerLabelRow {
  id: number;
  label: string;
}

/** A sticker without its image bytes. */
export interface StickerMeta {
  id: number;
  label: string | null;
  mimetype: string;
  moments: string | null;
  usage: string | null;
  active: number;
  sent_count: number;
  last_sent_at: string | null;
  created_at: string;
  size: number;
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

export const stickersModel = {
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
      .prepare('SELECT id, label FROM stickers WHERE label IS NOT NULL AND active = 1 ORDER BY label, id')
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

  /** Every sticker without its image - what the portal lists. */
  listMeta(): StickerMeta[] {
    return db
      .prepare(
        `SELECT id, label, mimetype, moments, usage, active, sent_count, last_sent_at, created_at, length(data) AS size
         FROM stickers ORDER BY label IS NULL DESC, label, id`,
      )
      .all() as StickerMeta[];
  },

  /** A labeled one uploaded from the portal (WhatsApp uploads go through createPending + setLabel). */
  createLabeled(createdBy: number, data: Buffer, label: string): number {
    const info = db.prepare("INSERT INTO stickers (label, data, mimetype, created_by) VALUES (?, ?, 'image/webp', ?)").run(label, data, createdBy);
    return Number(info.lastInsertRowid);
  },

  /** Only the fields given change; moments = null goes back to "suggested from the name". */
  update(id: number, fields: { label?: string; moments?: string[] | null; usage?: string | null; active?: boolean }): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.label !== undefined) {
      sets.push('label = ?');
      values.push(fields.label);
    }
    if (fields.moments !== undefined) {
      sets.push('moments = ?');
      values.push(fields.moments === null ? null : JSON.stringify(fields.moments));
    }
    if (fields.usage !== undefined) {
      sets.push('usage = ?');
      values.push(fields.usage);
    }
    if (fields.active !== undefined) {
      sets.push('active = ?');
      values.push(fields.active ? 1 : 0);
    }
    if (sets.length) db.prepare(`UPDATE stickers SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  /** Usable stickers (labeled, active) without images - what moment matching runs over. */
  listUsable(): StickerMeta[] {
    return this.listMeta().filter((s) => s.label && s.active);
  },

  markSent(id: number): void {
    db.prepare(`UPDATE stickers SET sent_count = sent_count + 1, last_sent_at = datetime('now') WHERE id = ?`).run(id);
  },

  delete(id: number): void {
    db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
  },
};
