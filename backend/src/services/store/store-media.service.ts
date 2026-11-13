import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../../config/env.js';

/**
 * Images of the order-taking assistant, on disk under data/store-media/<storeId>/.
 *
 * Two kinds, told apart by the file name's prefix:
 *   - "p-" public: product and promotion photos. Served without a session at
 *     /media/store/<storeId>/<file> (the portal's <img> tags and anyone the business shares its
 *     catalog with), under an unguessable random name.
 *   - "x-" private: what customers send (payment receipts, other photos). Only through the API,
 *     for the people who manage that store.
 *
 * The type is detected from the first bytes, never trusted from a file name or a Content-Type.
 */
const MEDIA_ROOT = resolve(env.db.path, '..', 'store-media');
export const MAX_STORE_IMAGE_BYTES = 6 * 1024 * 1024;

export class StoreMediaError extends Error {}

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

const FILE_RE = /^[px]-[a-f0-9]{24}\.(jpg|png|webp)$/;

export function mimeOfMedia(file: string): string {
  return file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

export function isPublicMedia(file: string): boolean {
  return FILE_RE.test(file) && file.startsWith('p-');
}

/** Absolute path of a stored image, or null when the name isn't one of ours or the file is gone. */
export function mediaPath(storeId: number, file: string): string | null {
  if (!Number.isInteger(storeId) || !FILE_RE.test(file)) return null;
  const path = join(MEDIA_ROOT, String(storeId), file);
  return existsSync(path) ? path : null;
}

export async function saveStoreImage(storeId: number, buffer: Buffer, visibility: 'public' | 'private'): Promise<string> {
  if (buffer.length > MAX_STORE_IMAGE_BYTES) throw new StoreMediaError(`La imagen pesa más de ${MAX_STORE_IMAGE_BYTES / 1024 / 1024} MB.`);
  const kind = SIGNATURES.find((s) => s.test(buffer));
  if (!kind) throw new StoreMediaError('El archivo no es una imagen JPG, PNG o WEBP.');
  const dir = join(MEDIA_ROOT, String(storeId));
  await mkdir(dir, { recursive: true });
  const name = `${visibility === 'public' ? 'p' : 'x'}-${randomBytes(12).toString('hex')}.${kind.ext}`;
  await writeFile(join(dir, name), buffer);
  return name;
}

export async function readStoreImage(storeId: number, file: string): Promise<Buffer | null> {
  const path = mediaPath(storeId, file);
  return path ? readFile(path) : null;
}

export async function deleteStoreImage(storeId: number, file: string | null | undefined): Promise<void> {
  if (!file) return;
  const path = mediaPath(storeId, file);
  if (path) await rm(path, { force: true });
}

/** Removes everything a store had on disk (when the store itself is deleted). */
export async function deleteStoreMedia(storeId: number): Promise<void> {
  await rm(join(MEDIA_ROOT, String(storeId)), { recursive: true, force: true });
}

export function publicMediaUrl(storeId: number, file: string | null): string | null {
  return file ? `/media/store/${storeId}/${file}` : null;
}
