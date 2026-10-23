import { db } from '../database/connection.js';
import type { PromoItem, PromoMedia, PromoKind, PromoStatus } from '../entities/promo.entity.js';

type Row = Omit<PromoItem, 'formats' | 'content' | 'files'> & { formats: string; content: string; files: string };

function parse<T>(text: string, fallback: T): T {
  try {
    return (JSON.parse(text) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function toItem(row: Row | undefined): PromoItem | undefined {
  if (!row) return undefined;
  return { ...row, formats: parse(row.formats, []), content: parse(row.content, {}), files: parse(row.files, {}) };
}

/** Advertising material (promo_items) and the settings shared by every video (promo_settings). */
export const promoModel = {
  create(input: { media: PromoMedia; kind: PromoKind; feature: string | null; layout: string | null; formats: string[]; idea: string; voice: string | null; createdBy: number; detail: string }): number {
    const r = db
      .prepare(
        `INSERT INTO promo_items (media, kind, feature, layout, formats, idea, voice, created_by, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.media, input.kind, input.feature, input.layout, JSON.stringify(input.formats), input.idea, input.voice, input.createdBy, input.detail);
    return Number(r.lastInsertRowid);
  },

  get(id: number): PromoItem | undefined {
    return toItem(db.prepare('SELECT * FROM promo_items WHERE id = ?').get(id) as Row | undefined);
  },

  list(limit = 300): PromoItem[] {
    return (db.prepare('SELECT * FROM promo_items ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as Row[]).map((r) => toItem(r)!);
  },

  /** Headlines/titles already used for the same kind and feature, so new ones take another angle. */
  recentTitles(media: PromoMedia, kind: PromoKind, feature: string | null, limit = 8): string[] {
    return (
      db
        .prepare(`SELECT title FROM promo_items WHERE media = ? AND kind = ? AND feature IS ? AND title != '' ORDER BY id DESC LIMIT ?`)
        .all(media, kind, feature, limit) as { title: string }[]
    ).map((r) => r.title);
  },

  setStatus(id: number, status: PromoStatus, detail = ''): void {
    db.prepare(`UPDATE promo_items SET status = ?, detail = ?, updated_at = datetime('now') WHERE id = ?`).run(status, detail.slice(0, 300), id);
  },

  setContent(id: number, title: string, caption: string, content: object): void {
    db.prepare(`UPDATE promo_items SET title = ?, caption = ?, content = ?, updated_at = datetime('now') WHERE id = ?`).run(title, caption, JSON.stringify(content), id);
  },

  setResult(id: number, files: object): void {
    db.prepare(`UPDATE promo_items SET files = ?, status = 'review', detail = '', updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(files), id);
  },

  review(id: number, approve: boolean): void {
    db.prepare(`UPDATE promo_items SET status = ?, approved_at = CASE WHEN ? THEN datetime('now') END, updated_at = datetime('now') WHERE id = ?`).run(
      approve ? 'approved' : 'rejected',
      approve ? 1 : 0,
      id,
    );
  },

  updateTexts(id: number, title: string, caption: string): void {
    db.prepare(`UPDATE promo_items SET title = ?, caption = ?, updated_at = datetime('now') WHERE id = ?`).run(title, caption, id);
  },

  delete(id: number): void {
    db.prepare('DELETE FROM promo_items WHERE id = ?').run(id);
  },

  /** After a restart: whatever was half-made goes back to the queue. */
  requeue(): number[] {
    db.prepare(`UPDATE promo_items SET status = 'pending' WHERE status = 'working'`).run();
    return (db.prepare(`SELECT id FROM promo_items WHERE status = 'pending' ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
  },

  getSetting(key: string): string | undefined {
    return (db.prepare('SELECT value FROM promo_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  },

  setSetting(key: string, value: string): void {
    db.prepare('INSERT INTO promo_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  },
};
