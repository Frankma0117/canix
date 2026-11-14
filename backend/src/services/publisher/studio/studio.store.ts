import { db } from '../../../database/connection.js';
import { DEFAULT_COLORS, type Colors, type Design, type DesignContent, type DesignKind, type DesignLayout, type DesignStatus, type FontKey, type Identity } from './studio.types.js';

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (text ? (JSON.parse(text) as T) : fallback) ?? fallback;
  } catch {
    return fallback;
  }
}

type Row = Omit<Design, 'content'> & { content: string };
const toDesign = (r: Row | undefined): Design | undefined => (r ? { ...r, content: parse(r.content, {}) } : undefined);

export const studioStore = {
  // ---------- identity ----------
  getIdentity(): Identity {
    const r = db.prepare('SELECT * FROM publisher_identity WHERE id = 1').get() as { colors: string; style: string; font: FontKey; logo_ref: string } | undefined;
    return { colors: { ...DEFAULT_COLORS, ...parse<Partial<Colors>>(r?.colors, {}) }, style: r?.style ?? '', font: r?.font ?? 'modern', logoRef: r?.logo_ref ?? '' };
  },
  saveIdentity(i: Identity): void {
    db.prepare(
      `INSERT INTO publisher_identity (id, colors, style, font, logo_ref, updated_at) VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET colors = excluded.colors, style = excluded.style, font = excluded.font, logo_ref = excluded.logo_ref, updated_at = datetime('now')`,
    ).run(JSON.stringify(i.colors), i.style, i.font, i.logoRef);
  },

  // ---------- designs ----------
  create(d: { kind: DesignKind; layout: DesignLayout; format: string; brief: string; useAi: boolean; createdBy: number | null }): number {
    const r = db
      .prepare(`INSERT INTO publisher_designs (kind, layout, format, brief, use_ai, created_by, detail) VALUES (?, ?, ?, ?, ?, ?, 'En cola')`)
      .run(d.kind, d.layout, d.format, d.brief, d.useAi ? 1 : 0, d.createdBy);
    return Number(r.lastInsertRowid);
  },
  get(id: number): Design | undefined {
    return toDesign(db.prepare('SELECT * FROM publisher_designs WHERE id = ?').get(id) as Row | undefined);
  },
  list(limit = 300): Design[] {
    return (db.prepare('SELECT * FROM publisher_designs ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as Row[]).map((r) => toDesign(r)!);
  },
  approved(): Design[] {
    return (db.prepare(`SELECT * FROM publisher_designs WHERE status = 'approved' AND file_ref != '' ORDER BY approved_at DESC, id DESC`).all() as Row[]).map((r) => toDesign(r)!);
  },
  recentHeadlines(kind: DesignKind, limit = 8): string[] {
    return (db.prepare(`SELECT title FROM publisher_designs WHERE kind = ? AND title != '' ORDER BY id DESC LIMIT ?`).all(kind, limit) as { title: string }[]).map((r) => r.title);
  },
  setStatus(id: number, status: DesignStatus, detail = ''): void {
    db.prepare(`UPDATE publisher_designs SET status = ?, detail = ?, updated_at = datetime('now') WHERE id = ?`).run(status, detail.slice(0, 300), id);
  },
  setContent(id: number, title: string, caption: string, content: DesignContent): void {
    db.prepare(`UPDATE publisher_designs SET title = ?, caption = ?, content = ?, updated_at = datetime('now') WHERE id = ?`).run(title, caption, JSON.stringify(content), id);
  },
  setArt(id: number, artRef: string): void {
    db.prepare(`UPDATE publisher_designs SET art_ref = ?, updated_at = datetime('now') WHERE id = ?`).run(artRef, id);
  },
  setResult(id: number, fileRef: string): void {
    db.prepare(`UPDATE publisher_designs SET file_ref = ?, status = 'review', detail = '', updated_at = datetime('now') WHERE id = ?`).run(fileRef, id);
  },
  review(id: number, approve: boolean): void {
    db.prepare(`UPDATE publisher_designs SET status = ?, approved_at = CASE WHEN ? THEN datetime('now') END, updated_at = datetime('now') WHERE id = ?`).run(approve ? 'approved' : 'rejected', approve ? 1 : 0, id);
  },
  delete(id: number): void {
    db.prepare('DELETE FROM publisher_designs WHERE id = ?').run(id);
  },
  requeue(): number[] {
    db.prepare(`UPDATE publisher_designs SET status = 'pending' WHERE status = 'working'`).run();
    return (db.prepare(`SELECT id FROM publisher_designs WHERE status = 'pending' ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
  },
  /** Pieces whose art an image model painted this month (they cost money). */
  aiThisMonth(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM publisher_designs WHERE use_ai = 1 AND created_at >= date('now', 'start of month')`).get() as { n: number }).n;
  },
};
