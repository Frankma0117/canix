import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/pool.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { permissionsRepo } from '../db/repositories/permissions.repo.js';
import { phoneToJid } from '../util/jid.js';
import { can } from '../permissions/engine.js';
import { hashPassword, verifyPassword, passwordProblem, generateTemporaryPassword } from './passwords.js';
import type { User } from '../types/index.js';

/**
 * Web portal authentication (number + password). Sessions are random 32-byte tokens handed to the
 * browser; only their SHA-256 is stored (web_sessions), with an absolute expiry and an idle limit.
 * Brute force is stopped per account (lockout after MAX_FAILED attempts) - the HTTP layer adds a
 * per-IP rate limit on top (see server/security.ts).
 */
const SESSION_TTL_DAYS = 7;
const SESSION_IDLE_HOURS = 24;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** SQLite-comparable UTC timestamp ('YYYY-MM-DD HH:MM:SS'), same form as datetime('now'). */
function utc(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}

// A real hash to verify against when the account doesn't exist, so "no such number" and "wrong
// password" take the same time (no account enumeration by timing).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

export interface LoginResult {
  token: string;
  user: User;
  mustChangePassword: boolean;
}

export async function login(phone: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 7 || !password) throw new AuthError('Número o contraseña incorrectos.');
  // Real number (with or without country code), or - for someone WhatsApp still only knows by
  // their @lid - that lid's digits, which is what their access message calls "código de acceso".
  const user =
    usersRepo.getByJidOrLid(phoneToJid(digits)) ??
    usersRepo.getByJidOrLid(`${digits}@s.whatsapp.net`) ??
    usersRepo.getByJidOrLid(`${digits}@lid`);

  if (!user || !user.password_hash) {
    await verifyPassword(password, await getDummyHash());
    throw new AuthError('Número o contraseña incorrectos.');
  }
  if (user.locked_until && user.locked_until > utc()) {
    throw new AuthError(`Demasiados intentos fallidos. Intenta de nuevo en unos minutos.`, 429);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? utc(LOCK_MINUTES * 60_000) : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    if (lock) permissionsRepo.recordAudit(null, user.id, 'auth.locked', { ip: meta.ip });
    throw new AuthError('Número o contraseña incorrectos.');
  }
  if (!can(user, 'portal.access')) {
    throw new AuthError('Tu cuenta no tiene acceso al portal web. Pídeselo al administrador.', 403);
  }

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  const token = createSession(user.id, meta);
  return { token, user, mustChangePassword: !!user.must_change_password };
}

export function createSession(userId: number, meta: { ip?: string; userAgent?: string } = {}): string {
  const token = randomBytes(32).toString('base64url');
  db.transaction(() => {
    // Opportunistic cleanup - keeps the table small without a separate job.
    db.prepare(`DELETE FROM web_sessions WHERE expires_at < ? OR last_seen_at < ?`).run(utc(), utc(-SESSION_IDLE_HOURS * 3_600_000));
    db.prepare('INSERT INTO web_sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)').run(
      sha256(token),
      userId,
      utc(SESSION_TTL_DAYS * 86_400_000),
      meta.ip?.slice(0, 64) ?? null,
      meta.userAgent?.slice(0, 200) ?? null,
    );
  })();
  return token;
}

/** Resolves a session token to its user, sliding the idle window. undefined = invalid/expired. */
export function userForSession(token: string): User | undefined {
  if (!token) return undefined;
  const hash = sha256(token);
  const row = db.prepare('SELECT user_id, expires_at, last_seen_at FROM web_sessions WHERE token_hash = ?').get(hash) as
    | { user_id: number; expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return undefined;
  if (row.expires_at < utc() || row.last_seen_at < utc(-SESSION_IDLE_HOURS * 3_600_000)) {
    db.prepare('DELETE FROM web_sessions WHERE token_hash = ?').run(hash);
    return undefined;
  }
  // Only touch the row once a minute - avoids a write on every single API call.
  if (row.last_seen_at < utc(-60_000)) db.prepare(`UPDATE web_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?`).run(hash);
  return usersRepo.getById(row.user_id);
}

export function logout(token: string): void {
  db.prepare('DELETE FROM web_sessions WHERE token_hash = ?').run(sha256(token));
}

export function revokeAllSessions(userId: number, exceptToken?: string): void {
  if (exceptToken) db.prepare('DELETE FROM web_sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256(exceptToken));
  else db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
}

/** Self-service change from the portal: needs the current password; other sessions are closed. */
export async function changePassword(user: User, current: string, next: string, keepToken?: string): Promise<void> {
  if (!(await verifyPassword(current, user.password_hash))) throw new AuthError('La contraseña actual no es correcta.', 400);
  await setPassword(user.id, next, { mustChange: false, actorId: user.id, keepToken });
}

/** Sets a password (validated). mustChange=true for temporary ones handed out by the admin/bot. */
export async function setPassword(
  userId: number,
  password: string,
  opts: { mustChange: boolean; actorId: number | null; keepToken?: string },
): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new AuthError(problem, 400);
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = ?, password_updated_at = datetime('now'),
         failed_logins = 0, locked_until = NULL WHERE id = ?`,
    ).run(hash, opts.mustChange ? 1 : 0, userId);
    revokeAllSessions(userId, opts.keepToken);
    permissionsRepo.recordAudit(opts.actorId, userId, opts.mustChange ? 'auth.temp_password' : 'auth.password_changed');
  })();
}

/** Generates + stores a temporary password (must be changed at next login) and returns it. */
export async function issueTemporaryPassword(userId: number, actorId: number | null): Promise<string> {
  const pwd = generateTemporaryPassword();
  await setPassword(userId, pwd, { mustChange: true, actorId });
  return pwd;
}
