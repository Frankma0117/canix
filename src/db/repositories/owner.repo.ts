import { db } from '../pool.js';
import type { Owner } from '../../types/index.js';

export const ownerRepo = {
  get(): Owner | undefined {
    return db.prepare('SELECT * FROM owner WHERE id = 1').get() as Owner | undefined;
  },

  /** Sets the owner if not already set (first message ever received wins). */
  setIfMissing(jid: string, name: string | null): void {
    db.prepare(
      'INSERT INTO owner (id, jid, name) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING',
    ).run(jid, name);
  },

  isOwner(jid: string): boolean {
    const owner = this.get();
    return owner?.jid === jid;
  },
};
