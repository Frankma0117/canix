import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import multer from 'multer';
import type { Request } from 'express';
import { db } from '../db/pool.js';
import { env } from '../config/env.js';

/**
 * File uploads for the web portal. Designed so a big or malicious upload can't hurt the bot:
 *   - multer streams to a temp file on disk (never buffers whole files in memory);
 *   - hard limits: size per file, files per request, fields;
 *   - the real type is detected from the file's first bytes (magic numbers), never trusted from
 *     the client's filename or Content-Type - anything not on the allow-list is deleted;
 *   - per-user storage quota;
 *   - stored under data/uploads with a random name; the DB row (uploaded_files) is the only way to
 *     reach it, and every read is ownership-checked by the route.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 5;
export const USER_QUOTA_BYTES = 200 * 1024 * 1024;

const uploadsRoot = resolve(process.cwd(), env.db.path, '..', 'uploads');
const tmpDir = join(uploadsRoot, 'tmp');

export type UploadPurpose = 'appointment' | 'garment' | 'general';

export interface StoredFile {
  id: number;
  owner_user_id: number;
  storage_name: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  purpose: UploadPurpose;
  ref_id: number | null;
  created_at: string;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];

async function sniff(path: string): Promise<{ mime: string; ext: string } | null> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    return SIGNATURES.find((s) => s.test(buf)) ?? null;
  } finally {
    await fh.close();
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej);
  });
}

/** Multer middleware: up to MAX_FILES_PER_REQUEST files in field "files", streamed to temp. */
export const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(tmpDir, { recursive: true }).then(
        () => cb(null, tmpDir),
        (err) => cb(err as Error, tmpDir),
      );
    },
    filename: (_req, _file, cb) => cb(null, randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST, fields: 10, fieldSize: 10_000, parts: 20 },
}).array('files', MAX_FILES_PER_REQUEST);

export function usedBytes(userId: number): number {
  return (db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM uploaded_files WHERE owner_user_id = ?').get(userId) as { n: number }).n;
}

/**
 * Validates and persists the temp files multer wrote for this request. All-or-nothing: if any file
 * is invalid or the quota would be exceeded, every temp file is deleted and nothing is stored.
 */
export async function persistUploads(req: Request, ownerId: number, purpose: UploadPurpose, refId: number | null): Promise<StoredFile[]> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const cleanup = () => Promise.all(files.map((f) => rm(f.path, { force: true })));
  if (!files.length) throw new UploadError('No llegó ningún archivo.');

  try {
    const checked: { f: Express.Multer.File; mime: string; ext: string; hash: string; size: number }[] = [];
    for (const f of files) {
      const kind = await sniff(f.path);
      if (!kind) throw new UploadError(`"${f.originalname}" no es un tipo permitido (JPG, PNG, WEBP o PDF).`, 415);
      const size = (await stat(f.path)).size;
      checked.push({ f, ...kind, hash: await sha256File(f.path), size });
    }
    const incoming = checked.reduce((n, c) => n + c.size, 0);
    if (usedBytes(ownerId) + incoming > USER_QUOTA_BYTES) {
      throw new UploadError(`Superarías tu espacio disponible (${USER_QUOTA_BYTES / 1024 / 1024} MB). Borra archivos que ya no necesites.`, 413);
    }

    const dir = join(uploadsRoot, String(ownerId));
    await mkdir(dir, { recursive: true });
    const stored: StoredFile[] = [];
    const insert = db.prepare(
      `INSERT INTO uploaded_files (owner_user_id, storage_name, original_name, mime, size_bytes, sha256, purpose, ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of checked) {
      const storageName = `${ownerId}/${randomBytes(16).toString('hex')}.${c.ext}`;
      await rename(c.f.path, join(uploadsRoot, storageName));
      const safeName = c.f.originalname.replace(/[^\w.\-() áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120) || `archivo.${c.ext}`;
      const id = Number(insert.run(ownerId, storageName, safeName, c.mime, c.size, c.hash, purpose, refId).lastInsertRowid);
      stored.push(getFile(id)!);
    }
    return stored;
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export function getFile(id: number): StoredFile | undefined {
  return db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(id) as StoredFile | undefined;
}

export function filesFor(purpose: UploadPurpose, refId: number): StoredFile[] {
  return db.prepare('SELECT * FROM uploaded_files WHERE purpose = ? AND ref_id = ? ORDER BY id').all(purpose, refId) as StoredFile[];
}

export function absolutePath(f: StoredFile): string {
  return join(uploadsRoot, f.storage_name);
}

export async function deleteFile(f: StoredFile): Promise<void> {
  db.prepare('DELETE FROM uploaded_files WHERE id = ?').run(f.id);
  await rm(absolutePath(f), { force: true });
}

/** Translates multer's own limit errors into friendly 4xx answers. */
export function uploadErrorMessage(err: unknown): { status: number; message: string } | null {
  if (err instanceof UploadError) return { status: err.status, message: err.message };
  if (err instanceof multer.MulterError) {
    const map: Record<string, string> = {
      LIMIT_FILE_SIZE: `Cada archivo puede pesar máximo ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      LIMIT_FILE_COUNT: `Máximo ${MAX_FILES_PER_REQUEST} archivos por envío.`,
      LIMIT_UNEXPECTED_FILE: 'Campo de archivo inesperado.',
    };
    return { status: 413, message: map[err.code] ?? 'No se pudo procesar la carga.' };
  }
  return null;
}
