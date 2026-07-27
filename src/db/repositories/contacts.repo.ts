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

  upsert(userId: number, name: string, jid: string, notes: string | null = null): Contact {
    db.prepare(
      `INSERT INTO contacts (user_id, name, jid, notes) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, jid) DO UPDATE SET name = excluded.name,
         notes = COALESCE(excluded.notes, contacts.notes)`,
    ).run(userId, name.trim(), jid, notes);
    return this.getByJid(userId, jid)!;
  },

  /** The jid to actually send to: prefer the lid once known (sending via the phone jid alone can
   *  fail for some accounts/privacy settings - see wa-manager.ts's lid-mapping.update handling). */
  sendTarget(contact: Contact): string {
    return contact.lid ?? contact.jid;
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
