import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromRoot } from '../../config/paths.js';

/**
 * AES-256-GCM for the platform tokens. The key comes from PUBLISHER_SECRET (any text) or, when it
 * isn't set, from a random key created once in data/publisher.key - so every project that copies
 * the module has its own key and the database alone never reveals a token.
 */
const KEY_FILE = fromRoot('data', 'publisher.key');
let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  const fromEnv = process.env.PUBLISHER_SECRET?.trim();
  if (fromEnv) {
    // Any text works: hash it down to 32 bytes.
    cached = createHash('sha256').update(fromEnv).digest();
    return cached;
  }
  if (!existsSync(KEY_FILE)) {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
    try {
      chmodSync(KEY_FILE, 0o600);
    } catch {
      /* Windows (development) - fine */
    }
  }
  cached = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  return cached;
}

/** `iv.tag.data` in base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(token: string): string {
  const [iv, tag, data] = token.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
