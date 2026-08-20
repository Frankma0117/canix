import { db } from '../pool.js';
import type { Sticker } from '../../types/index.js';

/** "Buenos Días" -> "buenos_dias" - strips accents, lowercases, collapses whitespace to a single
 *  underscore. Every label is stored/matched in this form, so a human typing it either way (with
 *  or without tildes) and the AI's exact-match send_sticker call always agree. */
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

export function normalizeStickerLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '') // strip the accent marks NFD split off (á -> a + U+0301, etc.)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
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

  /** The most recently uploaded sticker still waiting for a label from this admin, if any - see
   *  bot-manager.ts's "next plain-text message names it" flow. */
  getPendingFor(createdBy: number): Sticker | undefined {
    return db
      .prepare('SELECT * FROM stickers WHERE created_by = ? AND label IS NULL ORDER BY created_at DESC LIMIT 1')
      .get(createdBy) as Sticker | undefined;
  },

  setLabel(id: number, label: string): void {
    db.prepare('UPDATE stickers SET label = ? WHERE id = ?').run(label, id);
  },

  /** Only labeled stickers - a pending, not-yet-named one is never usable/listable. */
  listAll(): Sticker[] {
    return db.prepare('SELECT * FROM stickers WHERE label IS NOT NULL ORDER BY label').all() as Sticker[];
  },

  getByLabel(label: string): Sticker | undefined {
    return db.prepare('SELECT * FROM stickers WHERE label = ?').get(normalizeStickerLabel(label)) as Sticker | undefined;
  },

  /**
   * Best-effort lookup for automated system pushes (daily agenda, weekly report, etc. - see
   * scheduler/task-scheduler.ts) that never go through the AI tool-calling loop, so there's no
   * model turn to ask "does a sticker fit here?" - matches a label against any of the given
   * (already-normalized) keywords instead of needing an exact one. Picks one at random when
   * several match, so having more than one "buenos_dias" sticker just adds variety.
   */
  findByKeywords(keywords: string[]): Sticker | undefined {
    if (keywords.length === 0) return undefined;
    const clause = keywords.map(() => 'label LIKE ?').join(' OR ');
    const params = keywords.map((k) => `%${k}%`);
    const rows = db.prepare(`SELECT * FROM stickers WHERE label IS NOT NULL AND (${clause})`).all(...params) as Sticker[];
    return rows.length ? rows[Math.floor(Math.random() * rows.length)] : undefined;
  },

  delete(id: number): void {
    db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
  },
};
