import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../../config/env.js';
import { artProviders, falPaint } from '../studio/studio-art.js';
import type { Colors, FormatSpec } from '../studio/studio.types.js';

/**
 * Image and video generation as interfaces: the queue, the SEO and the panel only know these two.
 * Each project brings its own API key through its .env (PUBLISHER_FAL_KEY, falling back to FAL_KEY);
 * the simulated providers need nothing and cost nothing, so the whole flow can be tested for free.
 * Costs are estimates in USD cents, adjustable with PUBLISHER_IMAGE_COST_CENTS and
 * PUBLISHER_VIDEO_COST_CENTS_PER_SECOND.
 */
export type Aspect = 'square' | 'portrait' | 'landscape';
export const ASPECTS: Aspect[] = ['square', 'portrait', 'landscape'];
export const MAX_VIDEO_SECONDS = 10;

export interface ImageRequest { prompt: string; aspect: Aspect; colors: Colors }
export interface VideoRequest { prompt: string; aspect: Aspect; seconds: number; colors: Colors }
export interface Generated { data: Buffer; mime: string; ext: string }
export interface GeneratedVideo extends Generated { poster?: Generated }

interface BaseProvider {
  readonly key: string;
  readonly label: string;
  /** True for the test provider: no key, no cost. */
  readonly simulated: boolean;
  configured(): boolean;
  /** Which .env variables the provider needs (shown in the panel when it isn't configured). */
  readonly envVars: string[];
}
export interface ImageProvider extends BaseProvider {
  costCents(): number;
  generate(req: ImageRequest): Promise<Generated>;
}
export interface VideoProvider extends BaseProvider {
  costCents(seconds: number): number;
  generate(req: VideoRequest): Promise<GeneratedVideo>;
}

const falKey = () => process.env.PUBLISHER_FAL_KEY?.trim() || env.fal.apiKey;
const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

const ART_ASPECT: Record<Aspect, FormatSpec['art']> = { square: 'square_hd', portrait: 'portrait_16_9', landscape: 'landscape_16_9' };
const VIDEO_SIZE: Record<Aspect, [number, number]> = { square: [480, 480], portrait: [360, 640], landscape: [640, 360] };
const RATIO: Record<Aspect, string> = { square: '1:1', portrait: '9:16', landscape: '16:9' };

// ---------- images ----------

const mockImage: ImageProvider = {
  key: 'mock',
  label: 'Simulado (degradado de la marca, gratis)',
  simulated: true,
  envVars: [],
  configured: () => true,
  costCents: () => 0,
  async generate({ prompt, aspect, colors }) {
    return { data: await artProviders.mock.paint(prompt, ART_ASPECT[aspect], colors), mime: 'image/png', ext: 'png' };
  },
};

const falImage: ImageProvider = {
  key: 'fal',
  label: 'FLUX (fal.ai)',
  simulated: false,
  envVars: ['PUBLISHER_FAL_KEY (o FAL_KEY)'],
  configured: () => !!falKey(),
  costCents: () => num(process.env.PUBLISHER_IMAGE_COST_CENTS, 4),
  async generate({ prompt, aspect }) {
    return { data: await falPaint(falKey(), prompt, ART_ASPECT[aspect]), mime: 'image/jpeg', ext: 'jpg' };
  },
};

// ---------- videos ----------

const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg no está disponible en este servidor.'));
    const proc = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    const err: Buffer[] = [];
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${Buffer.concat(err).toString().slice(-300)}`))));
  });
}

const hex = (c: string) => c.replace('#', '0x');

const mockVideo: VideoProvider = {
  key: 'mock',
  label: 'Simulado (clip de color de la marca, gratis)',
  simulated: true,
  envVars: [],
  configured: () => !!ffmpegPath,
  costCents: () => 0,
  async generate({ aspect, seconds, colors }) {
    const dir = mkdtempSync(join(tmpdir(), 'pubvid-'));
    try {
      const [w, h] = VIDEO_SIZE[aspect];
      const out = join(dir, 'clip.mp4');
      // A slow color pulse between the brand's primary and dark colors, with silent audio so every platform accepts it.
      await runFfmpeg([
        '-f', 'lavfi', '-i', `color=c=${hex(colors.primary)}:s=${w}x${h}:r=12:d=${Math.max(1, Math.min(seconds, 3))}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
        '-vf', `fade=t=out:st=0.5:d=0.5:color=${hex(colors.dark)}`,
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', out,
      ]);
      const poster = await mockImage.generate({ prompt: '', aspect, colors });
      return { data: readFileSync(out), mime: 'video/mp4', ext: 'mp4', poster };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

const falVideo: VideoProvider = {
  key: 'fal',
  label: 'Video con IA (fal.ai)',
  simulated: false,
  envVars: ['PUBLISHER_FAL_KEY (o FAL_KEY)', 'PUBLISHER_VIDEO_MODEL (opcional)'],
  configured: () => !!falKey(),
  costCents: (seconds) => Math.round(num(process.env.PUBLISHER_VIDEO_COST_CENTS_PER_SECOND, 8) * seconds),
  async generate({ prompt, aspect, seconds }) {
    const model = process.env.PUBLISHER_VIDEO_MODEL?.trim() || 'fal-ai/ltx-video';
    const headers = { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' };
    // Video models take minutes: fal's queue (submit → poll → fetch) instead of one long request.
    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, aspect_ratio: RATIO[aspect], duration: seconds }),
      signal: AbortSignal.timeout(60_000),
    });
    const job = (await submit.json().catch(() => ({}))) as { status_url?: string; response_url?: string; detail?: unknown };
    if (!submit.ok || !job.status_url || !job.response_url) throw new Error(`fal.ai respondió ${submit.status}${typeof job.detail === 'string' ? `: ${job.detail}` : ''}.`);
    const deadline = Date.now() + 10 * 60_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = (await (await fetch(job.status_url, { headers, signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}))) as { status?: string };
      if (st.status === 'COMPLETED') break;
      if (st.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(st.status)) throw new Error(`fal.ai terminó con estado ${st.status}.`);
      if (Date.now() > deadline) throw new Error('El video tardó demasiado (más de 10 minutos).');
    }
    const result = (await (await fetch(job.response_url, { headers, signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}))) as { video?: { url?: string } };
    if (!result.video?.url) throw new Error('fal.ai no devolvió ningún video.');
    const file = await fetch(result.video.url, { signal: AbortSignal.timeout(120_000) });
    if (!file.ok) throw new Error('No se pudo descargar el video generado.');
    return { data: Buffer.from(await file.arrayBuffer()), mime: 'video/mp4', ext: 'mp4' };
  },
};

export const imageProviders: Record<string, ImageProvider> = { mock: mockImage, fal: falImage };
export const videoProviders: Record<string, VideoProvider> = { mock: mockVideo, fal: falVideo };

/** The one to use: the project's choice (settings) → the real one when its key exists → the simulated one. */
export function pickProvider<T extends BaseProvider>(all: Record<string, T>, chosen: string | undefined): T {
  const picked = chosen ? all[chosen] : undefined;
  if (picked?.configured()) return picked;
  const real = Object.values(all).find((p) => !p.simulated && p.configured());
  return real ?? all.mock;
}
