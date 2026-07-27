import { db } from '../pool.js';
import type { User, UserRole } from '../../types/index.js';

export const usersRepo = {
  getById(id: number): User | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  },

  /** Finds a user by jid OR lid - WhatsApp may route the same person's messages through either. */
  getByJidOrLid(jidOrLid: string): User | undefined {
    return db
      .prepare('SELECT * FROM users WHERE jid = ? OR lid = ?')
      .get(jidOrLid, jidOrLid) as User | undefined;
  },

  findByNameOrPhone(query: string): User[] {
    const digits = query.replace(/\D/g, '');
    if (digits.length >= 6) {
      return db
        .prepare(`SELECT * FROM users WHERE jid LIKE ? ORDER BY created_at`)
        .all(`${digits}%`) as User[];
    }
    return db
      .prepare('SELECT * FROM users WHERE name LIKE ? COLLATE NOCASE ORDER BY created_at')
      .all(`%${query}%`) as User[];
  },

  listAll(): User[] {
    return db.prepare('SELECT * FROM users ORDER BY created_at').all() as User[];
  },

  getAdmin(): User | undefined {
    return db.prepare(`SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get() as User | undefined;
  },

  isAdmin(userId: number): boolean {
    return this.getById(userId)?.role === 'admin';
  },

  /** True once at least one user exists (fresh installs bootstrap the first contact as admin). */
  hasAny(): boolean {
    return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c > 0;
  },

  /** Grants access. Idempotent: re-granting an already-registered jid just returns the existing user. */
  create(fields: { jid: string; name: string | null; role?: UserRole }): User {
    db.prepare(`INSERT INTO users (jid, name, role) VALUES (?, ?, ?) ON CONFLICT(jid) DO NOTHING`).run(
      fields.jid,
      fields.name,
      fields.role ?? 'user',
    );
    return this.getByJidOrLid(fields.jid)!;
  },

  setLid(jid: string, lid: string): void {
    db.prepare('UPDATE users SET lid = ? WHERE jid = ?').run(lid, jid);
  },

  remove(id: number): void {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};
