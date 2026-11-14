import { db } from '../../database/connection.js';
import type { Brand, Connection, MediaType, Platform, Post, PostStatus, SeoText, Target } from './publisher.types.js';

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (text ? (JSON.parse(text) as T) : fallback) ?? fallback;
  } catch {
    return fallback;
  }
}

type PostRow = Omit<Post, 'hashtags' | 'keywords' | 'seo'> & { hashtags: string; keywords: string; seo: string };
const toPost = (r: PostRow | undefined): Post | undefined => (r ? { ...r, hashtags: parse(r.hashtags, []), keywords: parse(r.keywords, []), seo: parse(r.seo, {}) } : undefined);

/** UTC text used by SQLite ('YYYY-MM-DD HH:MM:SS'). */
export const toDb = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');
export const fromDb = (s: string | null): string | null => (s ? `${s.replace(' ', 'T')}Z` : null);

const EMPTY_BRAND: Brand = { name: '', tone: '', language: 'es', audience: '', cta: '', hashtags: [], keywords: [] };

/** Everything the publisher keeps in the database (publisher_* tables). */
export const publisherStore = {
  // ---------- brand ----------
  getBrand(): Brand {
    const r = db.prepare('SELECT * FROM publisher_brand WHERE id = 1').get() as (Omit<Brand, 'hashtags' | 'keywords'> & { hashtags: string; keywords: string }) | undefined;
    return r ? { ...r, hashtags: parse(r.hashtags, []), keywords: parse(r.keywords, []) } : { ...EMPTY_BRAND };
  },
  saveBrand(b: Brand): void {
    db.prepare(
      `INSERT INTO publisher_brand (id, name, tone, language, audience, cta, hashtags, keywords, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, tone = excluded.tone, language = excluded.language, audience = excluded.audience,
         cta = excluded.cta, hashtags = excluded.hashtags, keywords = excluded.keywords, updated_at = datetime('now')`,
    ).run(b.name, b.tone, b.language, b.audience, b.cta, JSON.stringify(b.hashtags), JSON.stringify(b.keywords));
  },

  // ---------- connections ----------
  listConnections(): Connection[] {
    return db.prepare('SELECT * FROM publisher_connections ORDER BY platform').all() as Connection[];
  },
  getConnection(platform: Platform): Connection | undefined {
    return db.prepare('SELECT * FROM publisher_connections WHERE platform = ?').get(platform) as Connection | undefined;
  },
  saveConnection(c: { platform: Platform; provider: string; accountName: string; accountId?: string; accessEnc: string; refreshEnc: string | null; expiresAt: string | null }): void {
    db.prepare(
      `INSERT INTO publisher_connections (platform, provider, account_name, account_id, access_token_enc, refresh_token_enc, expires_at, status, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', '')
       ON CONFLICT(platform) DO UPDATE SET provider = excluded.provider, account_name = excluded.account_name, account_id = excluded.account_id, access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc, expires_at = excluded.expires_at, status = 'connected', last_error = '',
         connected_at = datetime('now'), updated_at = datetime('now')`,
    ).run(c.platform, c.provider, c.accountName, c.accountId ?? "", c.accessEnc, c.refreshEnc, c.expiresAt);
  },
  updateTokens(platform: Platform, accessEnc: string, expiresAt: string): void {
    db.prepare(`UPDATE publisher_connections SET access_token_enc = ?, expires_at = ?, updated_at = datetime('now') WHERE platform = ?`).run(accessEnc, expiresAt, platform);
  },
  markConnectionError(platform: Platform, message: string): void {
    db.prepare(`UPDATE publisher_connections SET status = 'error', last_error = ?, updated_at = datetime('now') WHERE platform = ?`).run(message.slice(0, 300), platform);
  },
  deleteConnection(platform: Platform): void {
    db.prepare('DELETE FROM publisher_connections WHERE platform = ?').run(platform);
  },

  // ---------- posts ----------
  createPost(p: { promoItemId: number | null; mediaType: MediaType; mediaRef: string; thumbnailRef: string; title: string; description: string; hashtags: string[]; keywords: string[]; createdBy: number | null }): number {
    const r = db
      .prepare(`INSERT INTO publisher_posts (promo_item_id, media_type, media_ref, thumbnail_ref, title, description, hashtags, keywords, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.promoItemId, p.mediaType, p.mediaRef, p.thumbnailRef, p.title, p.description, JSON.stringify(p.hashtags), JSON.stringify(p.keywords), p.createdBy);
    return Number(r.lastInsertRowid);
  },
  getPost(id: number): Post | undefined {
    return toPost(db.prepare('SELECT * FROM publisher_posts WHERE id = ?').get(id) as PostRow | undefined);
  },
  listPosts(limit = 200): Post[] {
    return (db.prepare('SELECT * FROM publisher_posts ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC LIMIT ?').all(limit) as PostRow[]).map((r) => toPost(r)!);
  },
  updatePost(id: number, p: { title: string; description: string; hashtags: string[]; keywords: string[]; seo: Partial<Record<Platform, SeoText>> }): void {
    db.prepare(`UPDATE publisher_posts SET title = ?, description = ?, hashtags = ?, keywords = ?, seo = ?, updated_at = datetime('now') WHERE id = ?`).run(
      p.title,
      p.description,
      JSON.stringify(p.hashtags),
      JSON.stringify(p.keywords),
      JSON.stringify(p.seo),
      id,
    );
  },
  setPostStatus(id: number, status: PostStatus, scheduledAt?: string | null): void {
    if (scheduledAt !== undefined) db.prepare(`UPDATE publisher_posts SET status = ?, scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`).run(status, scheduledAt, id);
    else db.prepare(`UPDATE publisher_posts SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  },
  markPostPublished(id: number, status: 'published' | 'partial'): void {
    db.prepare(`UPDATE publisher_posts SET status = ?, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(status, id);
  },
  deletePost(id: number): void {
    db.prepare('DELETE FROM publisher_posts WHERE id = ?').run(id);
  },

  // ---------- targets ----------
  setTargets(postId: number, platforms: Platform[]): void {
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM publisher_targets WHERE post_id = ? AND status != 'published'`).run(postId);
      const ins = db.prepare(`INSERT OR IGNORE INTO publisher_targets (post_id, platform) VALUES (?, ?)`);
      platforms.forEach((p) => ins.run(postId, p));
    });
    tx();
  },
  listTargets(postId: number): Target[] {
    return db.prepare('SELECT * FROM publisher_targets WHERE post_id = ? ORDER BY id').all(postId) as Target[];
  },
  /** Posts whose time has come and that still have something pending to send. */
  duePostIds(now: string): number[] {
    return (
      db
        .prepare(
          `SELECT DISTINCT p.id FROM publisher_posts p JOIN publisher_targets t ON t.post_id = p.id
           WHERE p.status IN ('scheduled', 'publishing') AND p.scheduled_at <= ? AND t.status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= ?)
           ORDER BY p.scheduled_at, p.id`,
        )
        .all(now, now) as { id: number }[]
    ).map((r) => r.id);
  },
  targetSucceeded(id: number, externalId: string, externalUrl: string): void {
    db.prepare(`UPDATE publisher_targets SET status = 'published', external_id = ?, external_url = ?, attempts = attempts + 1, last_error = '', published_at = datetime('now') WHERE id = ?`).run(externalId, externalUrl, id);
    db.prepare(`INSERT INTO publisher_attempts (target_id, ok, message) VALUES (?, 1, 'Publicado')`).run(id);
  },
  targetFailed(id: number, message: string, final: boolean, nextAttemptAt: string | null): void {
    db.prepare(`UPDATE publisher_targets SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?`).run(final ? 'failed' : 'pending', message.slice(0, 300), final ? null : nextAttemptAt, id);
    db.prepare(`INSERT INTO publisher_attempts (target_id, ok, message) VALUES (?, 0, ?)`).run(id, message.slice(0, 300));
  },
  /** «Reintentar»: failed targets go back to pending with a clean count. */
  resetFailedTargets(postId: number): void {
    db.prepare(`UPDATE publisher_targets SET status = 'pending', attempts = 0, next_attempt_at = NULL WHERE post_id = ? AND status = 'failed'`).run(postId);
  },
  attempts(postId: number, limit = 30): { platform: Platform; ok: number; message: string; at: string }[] {
    return db
      .prepare(`SELECT t.platform, a.ok, a.message, a.at FROM publisher_attempts a JOIN publisher_targets t ON t.id = a.target_id WHERE t.post_id = ? ORDER BY a.id DESC LIMIT ?`)
      .all(postId, limit) as { platform: Platform; ok: number; message: string; at: string }[];
  },

  // ---------- settings ----------
  getSetting(key: string): string | undefined {
    return (db.prepare('SELECT value FROM publisher_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  },
  setSetting(key: string, value: string): void {
    db.prepare('INSERT INTO publisher_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  },
};
