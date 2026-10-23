import { db } from '../database/connection.js';

export type FashionMessageKind = 'outfit' | 'garment' | 'delete_confirm';

export interface FashionMessageRef<T = unknown> {
  id: number;
  user_id: number;
  msg_id: string;
  kind: FashionMessageKind;
  garment_id: number | null;
  payload: T;
  created_at: string;
}

const KEEP_DAYS = 30;

/** Which Fashion Mode message a reaction landed on - see services/fashion/fashion-reactions.ts. */
export const fashionMessageRefsModel = {
  save(userId: number, msgId: string | null, kind: FashionMessageKind, garmentId: number | null, payload: unknown): void {
    if (!msgId) return;
    db.prepare('INSERT INTO fashion_message_refs (user_id, msg_id, kind, garment_id, payload) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      msgId,
      kind,
      garmentId,
      JSON.stringify(payload ?? {}),
    );
    db.prepare(`DELETE FROM fashion_message_refs WHERE user_id = ? AND created_at < datetime('now', ?)`).run(userId, `-${KEEP_DAYS} days`);
  },

  find<T = unknown>(userId: number, msgId: string): FashionMessageRef<T> | undefined {
    const row = db.prepare('SELECT * FROM fashion_message_refs WHERE user_id = ? AND msg_id = ? ORDER BY id DESC LIMIT 1').get(userId, msgId) as
      | (Omit<FashionMessageRef<T>, 'payload'> & { payload: string })
      | undefined;
    if (!row) return undefined;
    let payload: T;
    try {
      payload = JSON.parse(row.payload) as T;
    } catch {
      payload = {} as T;
    }
    return { ...row, payload };
  },
};
