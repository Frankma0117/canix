import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import type { User } from '../types/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The user whose panel token authenticated this request - set by resolvePanelUser(). */
      panelUser?: User;
    }
  }
}

const legacyTokenPath = join(process.cwd(), 'auth_info', 'admin-token.txt');

let cachedLegacyAdminToken: string | null = null;

/**
 * The admin's panel token used to be a single file/env-based secret shared by the whole panel
 * (back when the panel was admin-only). Kept only so an existing deployment's bookmarked token
 * keeps working: on first boot after this multi-client upgrade, the admin's `users.panel_token` is
 * seeded from this value once (see ensureAdminPanelToken() in index.ts) - after that, this legacy
 * source is never consulted again, everything goes through users.panel_token like every other client.
 */
export function legacyAdminToken(): string {
  if (cachedLegacyAdminToken) return cachedLegacyAdminToken;

  if (env.adminToken) {
    cachedLegacyAdminToken = env.adminToken;
    return cachedLegacyAdminToken;
  }
  if (existsSync(legacyTokenPath)) {
    cachedLegacyAdminToken = readFileSync(legacyTokenPath, 'utf8').trim();
    return cachedLegacyAdminToken;
  }

  const generated = randomBytes(24).toString('hex');
  mkdirSync(join(process.cwd(), 'auth_info'), { recursive: true });
  writeFileSync(legacyTokenPath, generated, 'utf8');
  cachedLegacyAdminToken = generated;
  return cachedLegacyAdminToken;
}

function extractToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return null;
}

/** Finds which user (if any) a panel token belongs to - every client (admin included) has their own. */
export function findUserByToken(token: string): User | undefined {
  if (!token) return undefined;
  return usersRepo.getByPanelToken(token);
}

/** Middleware: resolves the Bearer token to its owning user (req.panelUser) on every /api route
 *  except /api/auth/login - each client's panel only ever sees their own data (see http-server.ts). */
export function resolvePanelUser(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = token ? findUserByToken(token) : undefined;
  if (!user) {
    res.status(401).json({ error: 'Token invalido o ausente' });
    return;
  }
  req.panelUser = user;
  next();
}

/** Extra gate for admin-only panel routes (WhatsApp connection management) - chain after resolvePanelUser. */
export function requirePanelAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.panelUser?.role !== 'admin') {
    res.status(403).json({ error: 'Solo el administrador puede hacer esto' });
    return;
  }
  next();
}
