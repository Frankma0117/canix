import { db } from '../pool.js';
import type { PendingSharedContact } from '../../types/index.js';

export const pendingContactsRepo = {
  listForUser(userId: number): PendingSharedContact[] {
    return db
      .prepare('SELECT * FROM pending_shared_contacts WHERE user_id = ? ORDER BY id')
      .all(userId) as PendingSharedContact[];
  },

  /** Replaces whatever batch was already pending for this user - sharing a new set of contacts
   *  before answering the previous offer supersedes it, rather than stacking two unrelated offers
   *  the person would then have to disentangle. */
  replaceForUser(userId: number, contacts: { name: string; phone: string }[]): void {
    db.prepare('DELETE FROM pending_shared_contacts WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO pending_shared_contacts (user_id, name, phone) VALUES (?, ?, ?)');
    for (const c of contacts) insert.run(userId, c.name, c.phone);
  },

  clearForUser(userId: number): void {
    db.prepare('DELETE FROM pending_shared_contacts WHERE user_id = ?').run(userId);
  },
};
