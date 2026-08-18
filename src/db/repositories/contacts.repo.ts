import { db } from '../pool.js';
import type { Contact } from '../../types/index.js';

export const contactsRepo = {
  listAll(userId: number): Contact[] {
    return db
      .prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(userId) as Contact[];
  },

  getById(userId: number, id: number): Contact | undefined {
    return db
      .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?')
      .get(id, userId) as Contact | undefined;
  },

  getByJid(userId: number, jid: string): Contact | undefined {
    return db
      .prepare('SELECT * FROM contacts WHERE user_id = ? AND jid = ?')
      .get(userId, jid) as Contact | undefined;
  },

  /** Case-insensitive partial match on name, e.g. "juan" -> "Juan Pérez". */
  findByName(userId: number, query: string): Contact[] {
    return db
      .prepare('SELECT * FROM contacts WHERE user_id = ? AND name LIKE ? COLLATE NOCASE ORDER BY name')
      .all(userId, `%${query}%`) as Contact[];
  },

  /** Exact (case-insensitive) match on the saved @username label - see the `username` column
   *  comment in db/init.ts for why this is reference-only, not a live WhatsApp lookup. */
  getByUsername(userId: number, username: string): Contact | undefined {
    return db
      .prepare('SELECT * FROM contacts WHERE user_id = ? AND username = ? COLLATE NOCASE')
      .get(userId, username) as Contact | undefined;
  },

  upsert(userId: number, name: string, jid: string, notes: string | null = null, username: string | null = null): Contact {
    db.prepare(
      `INSERT INTO contacts (user_id, name, jid, notes, username) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, jid) DO UPDATE SET name = excluded.name,
         notes = COALESCE(excluded.notes, contacts.notes),
         username = COALESCE(excluded.username, contacts.username)`,
    ).run(userId, name.trim(), jid, notes, username);
    return this.getByJid(userId, jid)!;
  },

  /**
   * The jid to actually send to: always the phone jid, never the stored lid. Baileys already
   * routes a plain phone-jid send correctly on its own - substituting a lid we resolved
   * separately (rather than one learned from that person's own live traffic) turned out to
   * silently break messaging anyone who hadn't written to the bot first (see
   * wa-manager.ts's prefetchLid comment for the full story). `contact.lid` is still stored and
   * useful for *identifying* a contact, just not for choosing where to send.
   */
  sendTarget(contact: Contact): string {
    return contact.jid;
  },

  /** Partial update for a contact's editable fields (name/notes/username) - NOT jid, which is the
   *  contact's identity (see add_contact to re-save under a different number, which just upserts
   *  a separate row keyed on (user_id, jid)). */
  update(userId: number, id: number, fields: { name?: string; notes?: string | null; username?: string | null }): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare('UPDATE contacts SET name = ?, notes = ?, username = ? WHERE id = ? AND user_id = ?').run(
      fields.name ?? current.name,
      fields.notes === undefined ? current.notes : fields.notes,
      fields.username === undefined ? current.username : fields.username,
      id,
      userId,
    );
  },

  /** Called from wa-manager.ts when WhatsApp reveals a phone<->lid pairing - applies to every
   *  user's contact row for that phone number, since the mapping is a fact about the number itself. */
  setLidForPhoneJid(phoneJid: string, lid: string): void {
    db.prepare('UPDATE contacts SET lid = ? WHERE jid = ?').run(lid, phoneJid);
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
