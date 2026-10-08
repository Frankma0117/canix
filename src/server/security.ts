import type { NextFunction, Request, Response, ErrorRequestHandler } from 'express';
import { uploadErrorMessage } from './uploads.js';

/**
 * HTTP hardening for the web portal. The portal shares its process with the WhatsApp bot and the
 * scheduler, so the main goal here is that no amount of web traffic - abusive or just heavy - can
 * starve or crash the bot:
 *   - per-key rate limits (token buckets, in memory - one process, see util/single-instance.ts);
 *   - a hard timeout per request;
 *   - a concurrency cap for expensive operations (uploads);
 *   - small JSON bodies (set where express.json() is mounted);
 *   - a final error handler that always answers and never throws further.
 */

/** Standard defensive headers (no external libs). CSP allows only same-origin code. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; " +
      "connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
}

interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * Token-bucket limiter: `capacity` requests burst, refilled at capacity/windowMs. Keyed by
 * `keyFn(req)` (IP, user, IP+login...). Old buckets are swept periodically so memory stays flat.
 */
export function rateLimit(opts: { capacity: number; windowMs: number; keyFn?: (req: Request) => string; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = opts.capacity / opts.windowMs;
  const sweep = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs * 2;
    for (const [k, b] of buckets) if (b.updated < cutoff) buckets.delete(k);
  }, opts.windowMs);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = opts.keyFn ? opts.keyFn(req) : (req.ip ?? 'unknown');
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: opts.capacity, updated: now };
    b.tokens = Math.min(opts.capacity, b.tokens + (now - b.updated) * refillPerMs);
    b.updated = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      res.setHeader('Retry-After', String(Math.ceil((1 - b.tokens) / refillPerMs / 1000)));
      res.status(429).json({ error: opts.message ?? 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.' });
      return;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
}

/** Answers 503 if a request hasn't finished in `ms` (the handler's own work is not interrupted). */
export function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        console.error('[API] %s %s superó %dms.', req.method, req.originalUrl, ms);
        res.status(503).json({ error: 'El servidor tardó demasiado. Intenta de nuevo.' });
      }
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

/**
 * Caps how many requests of an expensive kind run at once; extra ones wait in a short queue and
 * are turned away (503) when the queue is full - instead of all of them piling onto the CPU/disk
 * at the same time as the bot.
 */
export function concurrencyLimit(max: number, maxQueue: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  };
  return (_req: Request, res: Response, next: NextFunction): void => {
    let released = false;
    const done = () => {
      if (!released) {
        released = true;
        release();
      }
    };
    const start = () => {
      res.on('finish', done);
      res.on('close', done);
      next();
    };
    if (active < max) {
      active++;
      start();
    } else if (queue.length < maxQueue) {
      queue.push(start);
    } else {
      res.status(503).json({ error: 'El servidor está ocupado procesando archivos. Intenta en unos segundos.' });
    }
  };
}

/** Last-resort error handler - logs, answers once, never rethrows. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const e = err as Error & { status?: number; statusCode?: number; type?: string; code?: string };
  let status = e.status ?? e.statusCode ?? 500;
  let message = status >= 500 ? 'Error interno del servidor.' : e.message;
  const upload = uploadErrorMessage(err);
  if (upload) {
    status = upload.status;
    message = upload.message;
  } else if (e.type === 'entity.too.large') {
    status = 413;
    message = 'La solicitud es demasiado grande.';
  } else if (e.type === 'entity.parse.failed') {
    status = 400;
    message = 'El cuerpo de la solicitud no es JSON válido.';
  }
  if (status >= 500) console.error('[API] Error en %s %s:', req.method, req.originalUrl, e.stack ?? e.message);
  if (!res.headersSent) res.status(status).json({ error: message });
};
