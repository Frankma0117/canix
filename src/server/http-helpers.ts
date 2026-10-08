import type { NextFunction, Request, Response } from 'express';
import { AccessError } from '../db/repositories/permissions.repo.js';
import { SchedulingError } from '../scheduling/service.js';
import { AuthError } from '../auth/web-auth.js';
import { uploadErrorMessage } from './uploads.js';

/**
 * Wraps a route handler (sync or async). Known business errors (invalid permission key, slot not
 * available, wrong password, bad upload...) become a 4xx with their own human message; anything
 * else goes to the global error handler (logged, generic 500) - never an unhandled rejection.
 */
export function h(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err: unknown) => {
        if (res.headersSent) return;
        if (err instanceof AuthError) return void res.status(err.status).json({ error: err.message });
        if (err instanceof AccessError || err instanceof SchedulingError) return void res.status(400).json({ error: err.message });
        const up = uploadErrorMessage(err);
        if (up) return void res.status(up.status).json({ error: up.message });
        // SQLite constraint violations caused by bad input (e.g. a CHECK failing) are a 400, not a 500.
        if ((err as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
          return void res.status(409).json({ error: 'Los datos no son válidos o ya existen.' });
        }
        next(err);
      });
  };
}

export function userId(req: Request): number {
  return req.panelUser!.id;
}

export const str = (v: unknown, max = 500): string | undefined => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max));
export const int = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : undefined);
export const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
export const intArr = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n)) : []);
