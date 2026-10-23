/** One saved sticker (see models/stickers.model.ts) - label is NULL right after the admin
 *  sends it, until their next plain-text message names it (see bot-manager.ts). */
export interface Sticker {
  id: number;
  label: string | null;
  data: Buffer;
  mimetype: string;
  /** JSON array of moment keys (services/stickers/sticker-moments.ts); NULL = not set by the admin. */
  moments: string | null;
  /** The admin's own note on when to use it - shown to the agent. */
  usage: string | null;
  /** 0 = paused: kept, never sent. */
  active: number;
  sent_count: number;
  last_sent_at: string | null;
  created_by: number;
  created_at: string;
}
