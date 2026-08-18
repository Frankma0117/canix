import { db } from '../pool.js';
import type { FashionSession } from '../../types/index.js';

export const fashionSessionsRepo = {
  get(userId: number): FashionSession | undefined {
    return db.prepare('SELECT * FROM fashion_sessions WHERE user_id = ?').get(userId) as FashionSession | undefined;
  },

  /** Same as get(), but never undefined - a user with no row yet is simply idle. */
  getOrIdle(userId: number): FashionSession {
    return this.get(userId) ?? { user_id: userId, state: 'FASHION_IDLE', data: '{}', updated_at: '' };
  },

  /** Parses `data` as JSON, falling back to {} on anything corrupt - never throws, so a bad state
   *  blob can't strand a user mid-flow. */
  getData<T = Record<string, unknown>>(userId: number): T {
    const session = this.get(userId);
    if (!session) return {} as T;
    try {
      return JSON.parse(session.data) as T;
    } catch {
      return {} as T;
    }
  },

  setState(userId: number, state: string, data: unknown = {}): void {
    const json = JSON.stringify(data ?? {});
    db.prepare(
      `INSERT INTO fashion_sessions (user_id, state, data, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at`,
    ).run(userId, state, json);
  },

  /** Back to idle - removes the row entirely (see get()'s default-idle fallback). */
  clear(userId: number): void {
    db.prepare('DELETE FROM fashion_sessions WHERE user_id = ?').run(userId);
  },
};
