import { randomBytes } from 'node:crypto';
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

  /** Restricts a user to only the given tool names, or pass null to clear the restriction (full access). */
  setAllowedTools(id: number, tools: string[] | null): void {
    db.prepare('UPDATE users SET allowed_tools = ? WHERE id = ?').run(tools ? JSON.stringify(tools) : null, id);
  },

  /** Parses a user's allowed_tools column. Null means unrestricted (every tool available). */
  getAllowedTools(user: User): string[] | null {
    if (!user.allowed_tools) return null;
    try {
      const parsed = JSON.parse(user.allowed_tools);
      return Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      return null;
    }
  },

  getByPanelToken(token: string): User | undefined {
    return db.prepare('SELECT * FROM users WHERE panel_token = ?').get(token) as User | undefined;
  },

  setPanelToken(id: number, token: string): void {
    db.prepare('UPDATE users SET panel_token = ? WHERE id = ?').run(token, id);
  },

  /** Returns this user's panel token, generating one on the fly if they don't have one yet
   *  (e.g. an account created before the per-client panel feature existed). */
  ensurePanelToken(id: number): string {
    const user = this.getById(id);
    if (user?.panel_token) return user.panel_token;
    const token = randomBytes(24).toString('hex');
    this.setPanelToken(id, token);
    return token;
  },

  remove(id: number): void {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};
