import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

const tokenPath = join(process.cwd(), 'auth_info', 'admin-token.txt');

let cachedToken: string | null = null;

/**
 * Admin panel access token. If ADMIN_TOKEN is set in .env that's used;
 * otherwise one is generated the first time and saved to
 * auth_info/admin-token.txt so it survives restarts without touching .env.
 */
export function getAdminToken(): string {
  if (cachedToken) return cachedToken;

  if (env.adminToken) {
    cachedToken = env.adminToken;
    return cachedToken;
  }

  if (existsSync(tokenPath)) {
    cachedToken = readFileSync(tokenPath, 'utf8').trim();
    return cachedToken;
  }

  const generated = randomBytes(24).toString('hex');
  mkdirSync(join(process.cwd(), 'auth_info'), { recursive: true });
  writeFileSync(tokenPath, generated, 'utf8');
  cachedToken = generated;
  return cachedToken;
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return null;
}

/** Middleware: requires a valid `Authorization: Bearer <token>` on all /api routes except /api/auth/login. */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token || !tokensMatch(token, getAdminToken())) {
    res.status(401).json({ error: 'Token invalido o ausente' });
    return;
  }
  next();
}

export function validateLogin(token: string): boolean {
  return Boolean(token) && tokensMatch(token, getAdminToken());
}
