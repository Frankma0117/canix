import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';
import { fromRoot } from '../../config/paths.js';

/**
 * Where the advertising files live: DigitalOcean Spaces (public-read, like the garment photos)
 * when its keys are set - videos weigh several MB and the server's disk is not the place for
 * them - or data/promo/ on disk otherwise (served at /promo-files/). Every key sits under
 * `canix-promo/<item id>/` and deletions never leave that folder (the bucket may be shared).
 */

const PREFIX = 'canix-promo/';
export const LOCAL_DIR = fromRoot('data', 'promo');
const spaces = env.fashion.spaces;
let client: S3Client | undefined;

export function usesSpaces(): boolean {
  return !!(spaces.endpoint && spaces.bucket && spaces.accessKeyId && spaces.secretAccessKey);
}

function s3(): S3Client {
  if (!client) {
    const region = spaces.region || spaces.endpoint.match(/^https?:\/\/([a-z0-9-]+)\.digitaloceanspaces\.com/i)?.[1] || 'us-east-1';
    client = new S3Client({ endpoint: spaces.endpoint, region, credentials: { accessKeyId: spaces.accessKeyId, secretAccessKey: spaces.secretAccessKey } });
  }
  return client;
}

const folderOf = (itemId: number | string) => `${PREFIX}${itemId}/`;

/** Stores a file of one item and returns its reference (Spaces key or "local:<relative path>"). */
export async function putFile(itemId: number | string, name: string, data: Buffer, contentType: string): Promise<string> {
  const key = `${folderOf(itemId)}${name}`;
  if (usesSpaces()) {
    await s3().send(new PutObjectCommand({ Bucket: spaces.bucket, Key: key, Body: data, ContentType: contentType, ACL: 'public-read', CacheControl: 'public, max-age=31536000, immutable' }));
    return key;
  }
  const path = join(LOCAL_DIR, String(itemId), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return `local:${itemId}/${name}`;
}

/** Bytes of a stored file (for reusing the generated music). */
export async function readFile(ref: string): Promise<Buffer | null> {
  if (ref.startsWith('local:')) {
    const path = safeLocal(ref);
    return path && existsSync(path) ? readFileSync(path) : null;
  }
  const res = await fetch(publicUrl(ref), { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  return res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

export function publicUrl(ref: string | undefined | null): string {
  if (!ref) return '';
  if (ref.startsWith('local:')) return `/promo-files/${ref.slice(6)}`;
  const host = spaces.endpoint.replace(/^https?:\/\//, '');
  return `https://${spaces.bucket}.${host}/${ref}`;
}

function safeLocal(ref: string): string | null {
  const path = resolve(LOCAL_DIR, ref.slice(6));
  return path.startsWith(LOCAL_DIR + sep) ? path : null;
}

/** Deletes every file of one item (only inside its own folder). Best effort: a leftover is harmless. */
export async function deleteItemFiles(itemId: number | string): Promise<void> {
  const folder = folderOf(itemId);
  rmSync(join(LOCAL_DIR, String(itemId)), { recursive: true, force: true });
  if (!usesSpaces()) return;
  try {
    const listed = await s3().send(new ListObjectsV2Command({ Bucket: spaces.bucket, Prefix: folder }));
    const keys = (listed.Contents ?? []).map((o) => o.Key!).filter((k) => k.startsWith(folder));
    if (keys.length) await s3().send(new DeleteObjectsCommand({ Bucket: spaces.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  } catch (err) {
    console.error('[PROMO] Could not delete files of %s (harmless leftover):', itemId, (err as Error).message);
  }
}

/** Deletes single files of one item (a redraw replaces its images). Refuses anything outside the item's folder. */
export async function deleteFiles(itemId: number | string, refs: string[]): Promise<void> {
  const folder = folderOf(itemId);
  const local = refs.filter((r) => r.startsWith(`local:${itemId}/`)).map(safeLocal).filter((p): p is string => !!p);
  local.forEach((p) => rmSync(p, { force: true }));
  const keys = refs.filter((r) => r.startsWith(folder));
  if (!keys.length || !usesSpaces()) return;
  await s3()
    .send(new DeleteObjectsCommand({ Bucket: spaces.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }))
    .catch((err: Error) => console.error('[PROMO] Could not delete old files (harmless leftover):', err.message));
}
