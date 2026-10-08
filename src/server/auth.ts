import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { userForSession } from '../auth/web-auth.js';
import { effectivePermissions } from '../permissions/engine.js';
import type { User } from '../types/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The authenticated portal user - set by resolvePanelUser(). */
      panelUser?: User;
      /** Their effective permissions, computed once per request. */
      panelPermissions?: Set<string>;
      /** The bearer token used (session token, or the admin's legacy token). */
      sessionToken?: string;
    }
  }
}

const legacyTokenPath = join(process.cwd(), 'auth_info', 'admin-token.txt');
let cachedLegacyAdminToken: string | null = null;

/**
 * The admin's old single panel token (file/env based). Kept ONLY as the admin's way in until they
 * set a portal password - see resolvePanelUser. Seeded into users.panel_token at boot (index.ts).
 */
export function legacyAdminToken(): string {
  if (cachedLegacyAdminToken) return cachedLegacyAdminToken;
  if (env.adminToken) return (cachedLegacyAdminToken = env.adminToken);
  if (existsSync(legacyTokenPath)) return (cachedLegacyAdminToken = readFileSync(legacyTokenPath, 'utf8').trim());
  const generated = randomBytes(24).toString('hex');
  mkdirSync(join(process.cwd(), 'auth_info'), { recursive: true });
  writeFileSync(legacyTokenPath, generated, 'utf8');
  return (cachedLegacyAdminToken = generated);
}

export function extractToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim() || null;
  return null;
}

/**
 * Legacy token login is accepted only for the administrator and only while they have no portal
 * password yet (bootstrap path). Once a password exists, sessions are the only way in, for
 * everyone - non-admin legacy tokens stopped working with the move to passwords.
 */
function userForLegacyToken(token: string): User | undefined {
  const user = usersRepo.getByPanelToken(token);
  return user && user.role === 'admin' && !user.password_hash ? user : undefined;
}

/** Paths a user with a temporary password may still call (to change it, or leave). */
const MUST_CHANGE_ALLOWED = new Set(['/auth/me', '/auth/change-password', '/auth/logout']);

/** Middleware for every /api route except login: resolves the session to req.panelUser. */
export function resolvePanelUser(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = token ? (userForSession(token) ?? userForLegacyToken(token)) : undefined;
  if (!user || !token) {
    res.status(401).json({ error: 'Sesión inválida o expirada. Inicia sesión de nuevo.' });
    return;
  }
  const perms = effectivePermissions(user);
  if (user.role !== 'admin' && !perms.has('portal.access')) {
    res.status(403).json({ error: 'Tu cuenta ya no tiene acceso al portal web.', code: 'NO_PORTAL' });
    return;
  }
  if (user.must_change_password && !MUST_CHANGE_ALLOWED.has(req.path)) {
    res.status(403).json({ error: 'Debes cambiar tu contraseña temporal antes de continuar.', code: 'MUST_CHANGE_PASSWORD' });
    return;
  }
  req.panelUser = user;
  req.panelPermissions = perms;
  req.sessionToken = token;
  next();
}

export function requirePanelAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.panelUser?.role !== 'admin') {
    res.status(403).json({ error: 'Solo el administrador puede hacer esto.' });
    return;
  }
  next();
}

/** Allows the request if the user has ANY of the given permissions (admins always pass). */
export function requirePermission(...keys: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const perms = req.panelPermissions;
    if (req.panelUser?.role === 'admin' || (perms && keys.some((k) => perms.has(k)))) {
      next();
      return;
    }
    res.status(403).json({ error: 'No tienes habilitado este módulo. Pídeselo al administrador.' });
  };
}
