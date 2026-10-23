import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository root (the folder that holds backend/, frontend/, data/, auth_info/, .env).
 * Every runtime path is resolved from here instead of process.cwd(), so the backend behaves the
 * same whether it is started from the repo root, from backend/, or by a process supervisor.
 */
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** An absolute path under the repository root (absolute inputs are returned unchanged). */
export function fromRoot(...segments: string[]): string {
  return resolve(ROOT_DIR, ...segments);
}

/** Built web assets (portal + public site), produced by `npm run build` in frontend/. */
export const PUBLIC_DIR = fromRoot('public');

/** WhatsApp session credentials and the legacy admin token. Never versioned. */
export const AUTH_DIR = fromRoot('auth_info');
