import { db } from '../pool.js';
import type { Contact } from '../../types/index.js';

export const contactsRepo = {
  listAll(): Contact[] {
    return db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all() as Contact[];
  },

  getById(id: number): Contact | undefined {
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Contact | undefined;
  },

  getByJid(jid: string): Contact | undefined {
    return db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid) as Contact | undefined;
  },

  /** Case-insensitive partial match on name, e.g. "juan" -> "Juan Pérez". */
  findByName(query: string): Contact[] {
    return db
      .prepare('SELECT * FROM contacts WHERE name LIKE ? COLLATE NOCASE ORDER BY name')
      .all(`%${query}%`) as Contact[];
  },

  upsert(name: string, jid: string, notes: string | null = null): Contact {
    db.prepare(
      `INSERT INTO contacts (name, jid, notes) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name,
         notes = COALESCE(excluded.notes, contacts.notes)`,
    ).run(name.trim(), jid, notes);
    return this.getByJid(jid)!;
  },

  remove(id: number): void {
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  },
};
