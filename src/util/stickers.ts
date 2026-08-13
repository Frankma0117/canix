import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Same CJS-interop reasoning as audio/ffmpeg.ts.
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

// Distinct seeds for ffmpeg's `gradients` source filter - each produces a different colorful
// radial pattern, no font/emoji rendering involved (that would need a bundled font file and
// wouldn't render color emoji glyphs anyway - see the comment below). Purely decorative "did it!"
// visual variety, cheap to generate and works identically on any deploy target.
const CELEBRATION_SEEDS = [3, 11, 17, 29, 41, 53] as const;

let cachedPool: Promise<Buffer[]> | null = null;

function renderGradientWebp(seed: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static no proveyo un binario para esta plataforma'));
      return;
    }
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `gradients=s=512x512:type=radial:nb_colors=4:seed=${seed}`,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-f',
      'webp',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => errChunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg salio con codigo ${code}: ${Buffer.concat(errChunks).toString().slice(0, 500)}`));
    });
  });
}

/**
 * Builds (once per process) and caches a small pool of celebration stickers. Generating real
 * sticker "art" (a checkmark, a trophy, etc.) would need either a bundled image library (sharp/
 * jimp - both would risk the same native-binding/Node-version pain better-sqlite3 already causes
 * on this machine, see memory) or drawtext with a font file, and drawtext with libfreetype can't
 * render color emoji glyphs anyway (COLR/CPAL fonts aren't supported, only plain outline glyphs) -
 * so a colorful abstract gradient badge is the reliable choice that needs neither. Reused across
 * every completion instead of a decorative text.
 */
function celebrationPool(): Promise<Buffer[]> {
  if (!cachedPool) {
    cachedPool = Promise.all(CELEBRATION_SEEDS.map(renderGradientWebp)).catch((err) => {
      cachedPool = null; // don't poison the cache forever on a transient failure - retry next time
      throw err;
    });
  }
  return cachedPool;
}

/** A random celebration sticker (webp buffer), or null if ffmpeg isn't available/failed - callers
 *  should treat this as best-effort and never block a completion confirmation on it. */
export async function pickCelebrationSticker(): Promise<Buffer | null> {
  try {
    const pool = await celebrationPool();
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  } catch (err) {
    console.error('[STICKER] No se pudo generar el sticker de celebracion:', (err as Error).message);
    return null;
  }
}
