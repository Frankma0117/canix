import { db } from '../../database/connection.js';

export interface NotifyClient {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  webhook_url: string;
  webhook_secret_enc: string;
  enabled: number;
  created_at: string;
  last_used_at: string | null;
}

export type MessageStatus = 'sent' | 'failed' | 'pending' | 'approved' | 'rejected' | 'expired';

export interface NotifyMessage {
  id: number;
  client_id: number;
  kind: 'message' | 'approval';
  title: string;
  body: string;
  image_url: string;
  ref: string;
  status: MessageStatus;
  token: string | null;
  wa_message_id: string | null;
  decided_via: 'reaction' | 'link' | null;
  decided_at: string | null;
  expires_at: string | null;
  webhook_state: 'none' | 'pending' | 'sent' | 'failed';
  webhook_attempts: number;
  webhook_next_at: string | null;
  webhook_error: string;
  error: string;
  created_at: string;
}

export const toDb = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');
export const fromDb = (s: string | null): string | null => (s ? `${s.replace(' ', 'T')}Z` : null);

export const notifyStore = {
  // ---------- clients ----------
  listClients(): NotifyClient[] {
    return db.prepare('SELECT * FROM notify_clients ORDER BY name').all() as NotifyClient[];
  },
  getClient(id: number): NotifyClient | undefined {
    return db.prepare('SELECT * FROM notify_clients WHERE id = ?').get(id) as NotifyClient | undefined;
  },
  clientByKeyHash(hash: string): NotifyClient | undefined {
    return db.prepare('SELECT * FROM notify_clients WHERE key_hash = ?').get(hash) as NotifyClient | undefined;
  },
  createClient(c: { name: string; keyHash: string; keyPrefix: string; webhookUrl: string; webhookSecretEnc: string }): number {
    return Number(
      db.prepare('INSERT INTO notify_clients (name, key_hash, key_prefix, webhook_url, webhook_secret_enc) VALUES (?, ?, ?, ?, ?)').run(c.name, c.keyHash, c.keyPrefix, c.webhookUrl, c.webhookSecretEnc).lastInsertRowid,
    );
  },
  updateClient(id: number, c: { webhookUrl?: string; enabled?: boolean }): void {
    if (c.webhookUrl !== undefined) db.prepare('UPDATE notify_clients SET webhook_url = ? WHERE id = ?').run(c.webhookUrl, id);
    if (c.enabled !== undefined) db.prepare('UPDATE notify_clients SET enabled = ? WHERE id = ?').run(c.enabled ? 1 : 0, id);
  },
  rotateKey(id: number, keyHash: string, keyPrefix: string): void {
    db.prepare('UPDATE notify_clients SET key_hash = ?, key_prefix = ? WHERE id = ?').run(keyHash, keyPrefix, id);
  },
  rotateSecret(id: number, secretEnc: string): void {
    db.prepare('UPDATE notify_clients SET webhook_secret_enc = ? WHERE id = ?').run(secretEnc, id);
  },
  touch(id: number): void {
    db.prepare(`UPDATE notify_clients SET last_used_at = datetime('now') WHERE id = ?`).run(id);
  },
  deleteClient(id: number): void {
    db.prepare('DELETE FROM notify_clients WHERE id = ?').run(id);
  },

  // ---------- messages ----------
  createMessage(m: { clientId: number; kind: 'message' | 'approval'; title: string; body: string; imageUrl: string; ref: string; status: MessageStatus; token?: string; expiresAt?: string }): number {
    return Number(
      db
        .prepare('INSERT INTO notify_messages (client_id, kind, title, body, image_url, ref, status, token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(m.clientId, m.kind, m.title, m.body, m.imageUrl, m.ref, m.status, m.token ?? null, m.expiresAt ?? null).lastInsertRowid,
    );
  },
  getMessage(id: number): NotifyMessage | undefined {
    return db.prepare('SELECT * FROM notify_messages WHERE id = ?').get(id) as NotifyMessage | undefined;
  },
  byToken(token: string): NotifyMessage | undefined {
    return db.prepare('SELECT * FROM notify_messages WHERE token = ?').get(token) as NotifyMessage | undefined;
  },
  byWaId(waId: string): NotifyMessage | undefined {
    return db.prepare('SELECT * FROM notify_messages WHERE wa_message_id = ?').get(waId) as NotifyMessage | undefined;
  },
  recent(limit = 60): (NotifyMessage & { client_name: string })[] {
    return db.prepare('SELECT m.*, c.name AS client_name FROM notify_messages m JOIN notify_clients c ON c.id = m.client_id ORDER BY m.id DESC LIMIT ?').all(limit) as (NotifyMessage & { client_name: string })[];
  },
  pendingCount(clientId: number): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM notify_messages WHERE client_id = ? AND status = 'pending'`).get(clientId) as { n: number }).n;
  },
  setSent(id: number, waId: string | null): void {
    db.prepare('UPDATE notify_messages SET wa_message_id = ? WHERE id = ?').run(waId, id);
  },
  setFailed(id: number, error: string): void {
    db.prepare(`UPDATE notify_messages SET status = 'failed', error = ? WHERE id = ?`).run(error.slice(0, 300), id);
  },
  /** First decision wins: only a pending approval changes. Returns whether this call decided it. */
  decide(id: number, status: 'approved' | 'rejected' | 'expired', via: 'reaction' | 'link' | null, webhook: boolean): boolean {
    const r = db
      .prepare(`UPDATE notify_messages SET status = ?, decided_via = ?, decided_at = datetime('now'), webhook_state = ?, webhook_attempts = 0, webhook_next_at = NULL WHERE id = ? AND status = 'pending'`)
      .run(status, via, webhook ? 'pending' : 'none', id);
    return r.changes === 1;
  },
  expiredIds(now: string): number[] {
    return (db.prepare(`SELECT id FROM notify_messages WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`).all(now) as { id: number }[]).map((r) => r.id);
  },
  webhooksDue(now: string): NotifyMessage[] {
    return db.prepare(`SELECT * FROM notify_messages WHERE webhook_state = 'pending' AND (webhook_next_at IS NULL OR webhook_next_at <= ?) ORDER BY id LIMIT 20`).all(now) as NotifyMessage[];
  },
  webhookResult(id: number, ok: boolean, attempts: number, error: string, nextAt: string | null, final: boolean): void {
    db.prepare('UPDATE notify_messages SET webhook_state = ?, webhook_attempts = ?, webhook_error = ?, webhook_next_at = ? WHERE id = ?').run(ok ? 'sent' : final ? 'failed' : 'pending', attempts, error.slice(0, 300), nextAt, id);
  },
};
