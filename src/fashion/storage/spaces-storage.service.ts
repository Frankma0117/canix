import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';
import type { StorageService, UploadResult } from './storage.service.js';

const UPLOAD_TIMEOUT_MS = 15_000;

/** Races any promise against a hard timeout - same shape as wa-manager.ts's resolveVersion() -
 *  so a hung Spaces request can never block the add-garment flow indefinitely. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}: tiempo de espera agotado`)), ms)),
  ]);
}

/** One retry after a short pause - same shape as ai-agent.ts's callModelWithRetry, not an
 *  infinite loop. */
async function withOneRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[FASHION] ${label} falló (intento 1/2):`, (err as Error).message);
    await new Promise((r) => setTimeout(r, 1000));
    return fn();
  }
}

/** DigitalOcean Spaces endpoints are always "<region>.digitaloceanspaces.com" (e.g.
 *  "sfo3.digitaloceanspaces.com") - falls back to reading the region straight out of the endpoint
 *  when DO_SPACES_REGION isn't set, instead of a hardcoded 'us-east-1'. That hardcoded fallback
 *  used to look harmless ("the SDK requires a value; DigitalOcean ignores it"), but it's actually
 *  wrong: the SDK signs every request with SigV4, which bakes the region into the signature itself
 *  - a real DO datacenter endpoint (sfo3, nyc3, ams3, ...) signed as 'us-east-1' produces a
 *  signature DO's servers reject with "the request signature we calculated does not match the
 *  signature you provided", even though the access key/secret are perfectly correct. */
function regionFromEndpoint(endpoint: string): string | undefined {
  return endpoint.match(/^https?:\/\/([a-z0-9-]+)\.digitaloceanspaces\.com/i)?.[1];
}

/** Constructed lazily (never at module load) so a missing DO_SPACES_SECRET_ACCESS_KEY never
 *  crashes boot when Fashion Mode is disabled - see env.fashion.enabled gating in bot-manager.ts. */
function buildClient(): S3Client {
  const { endpoint, region, accessKeyId, secretAccessKey } = env.fashion.spaces;
  return new S3Client({
    endpoint,
    region: region || regionFromEndpoint(endpoint) || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
}

function keyFor(userId: number, publicId: string, filename: string): string {
  return `fashion/users/${userId}/garments/${publicId}/${filename}`;
}

export class SpacesStorageService implements StorageService {
  private client: S3Client | undefined;

  private getClient(): S3Client {
    if (!this.client) this.client = buildClient();
    return this.client;
  }

  private async put(key: string, buffer: Buffer, contentType: string): Promise<UploadResult> {
    await withOneRetry(
      () =>
        withTimeout(
          this.getClient().send(
            new PutObjectCommand({
              Bucket: env.fashion.spaces.bucket,
              Key: key,
              Body: buffer,
              ContentType: contentType,
              ACL: 'public-read',
            }),
          ),
          UPLOAD_TIMEOUT_MS,
          `Subida a Spaces (${key})`,
        ),
      `Subida a Spaces (${key})`,
    );
    return { key, url: this.getPublicUrl(key) };
  }

  async uploadOriginal(userId: number, publicId: string, buffer: Buffer, contentType: string, ext: string): Promise<UploadResult> {
    return this.put(keyFor(userId, publicId, `original.${ext}`), buffer, contentType);
  }

  async uploadThumbnail(userId: number, publicId: string, buffer: Buffer, ext: string): Promise<UploadResult> {
    return this.put(keyFor(userId, publicId, `thumbnail.${ext}`), buffer, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await withTimeout(
        this.getClient().send(
          new DeleteObjectsCommand({
            Bucket: env.fashion.spaces.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        ),
        UPLOAD_TIMEOUT_MS,
        'Borrado en Spaces',
      );
    } catch (err) {
      // Best-effort: an orphaned object in Spaces is harmless (never shown to anyone without the
      // exact key) - never let a cleanup failure surface as a user-facing error.
      console.error('[FASHION] No se pudo borrar de Spaces (huérfano inofensivo):', (err as Error).message);
    }
  }

  getPublicUrl(key: string): string {
    // Public-read bucket (user's confirmed choice) - direct virtual-hosted-style URL, no presigned
    // URLs needed. Matches exactly the endpoint form DigitalOcean's own dashboard shows.
    const host = env.fashion.spaces.endpoint.replace(/^https?:\/\//, '');
    return `https://${env.fashion.spaces.bucket}.${host}/${key}`;
  }
}

export const spacesStorageService = new SpacesStorageService();
