import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromRoot } from '../../config/paths.js';

/**
 * Draws the advertising material: a headless browser (Playwright · Chromium) opens the stage
 * (frontend/public/promo/stage.html, straight from disk - no server, no login) and photographs it.
 * Videos are recorded frame by frame - the stage is a pure function of time (window.stageAt(t)),
 * so every frame is exact however slow the server is - and ffmpeg (ffmpeg-static) joins the frames
 * with the narration, the music and the chat "pops" into an MP4 (H.264 + AAC, faststart).
 *
 * Only ever runs inside promo-worker.ts (a child process with low CPU priority), never in the
 * process that holds the WhatsApp session.
 */

const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

// The browser lives inside the repo (bin/ is never versioned), installed by deploy/ubuntu-10-setup-promo.sh.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fromRoot('bin', 'ms-playwright');

export const VIDEO_SIZES = { landscape: [1920, 1080], vertical: [1080, 1920] } as const;
export const IMAGE_SIZES = { square: [1080, 1080], story: [1080, 1920], landscape: [1920, 1080] } as const;
const FPS = Number(process.env.PROMO_FPS ?? 30);
const STAGE = pathToFileURL(fromRoot('frontend', 'public', 'promo', 'stage.html')).href;

type Browser = import('playwright').Browser;

async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright');
  // PROMO_BROWSER=msedge uses the installed Edge (development on Windows).
  const browser = await chromium.launch({ channel: process.env.PROMO_BROWSER || undefined, args: ['--disable-dev-shm-usage', '--font-render-hinting=none', '--allow-file-access-from-files'] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function openStage(browser: Browser, w: number, h: number) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, bypassCSP: true });
  await page.goto(STAGE, { waitUntil: 'load', timeout: 30_000 });
  return page;
}

/** True when ffmpeg and the browser are installed (the portal says so instead of failing later). */
export async function canRender(): Promise<boolean> {
  if (!ffmpegPath) return false;
  if (process.env.PROMO_BROWSER) return true;
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** Photographs the stage in image mode. Returns a JPEG. */
export async function renderImage(stage: object, fmt: keyof typeof IMAGE_SIZES): Promise<Buffer> {
  const [w, h] = IMAGE_SIZES[fmt];
  return withBrowser(async (browser) => {
    const page = await openStage(browser, w, h);
    await page.evaluate((d) => (globalThis as unknown as { posterSetup: (x: object) => void }).posterSetup(d), stage);
    await page.waitForFunction('window.stageReady === true', undefined, { timeout: 60_000 });
    return page.screenshot({ type: 'jpeg', quality: 93 });
  });
}

/**
 * Records the stage frame by frame into outPath (video only). Frame 0 is the cover (the moment
 * `coverAt`), so every platform shows it as the thumbnail. Returns the cover as a JPEG.
 */
export async function renderVideo(stage: { total: number }, fmt: keyof typeof VIDEO_SIZES, outPath: string, coverAt: number, progress: (f: number) => void): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg no está disponible');
  const [w, h] = VIDEO_SIZES[fmt];
  const frames = Math.floor(stage.total * FPS);
  return withBrowser(async (browser) => {
    const page = await openStage(browser, w, h);
    await page.evaluate((d) => (globalThis as unknown as { stageSetup: (x: object) => void }).stageSetup(d), stage);
    await page.waitForFunction('window.stageReady === true', undefined, { timeout: 60_000 });
    const at = (t: number) => page.evaluate((x) => (globalThis as unknown as { stageAt: (s: number) => void }).stageAt(x), t);
    await at(coverAt);
    const cover = await page.screenshot({ type: 'jpeg', quality: 90 });
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2', '-r', String(FPS), outPath];
    const proc = spawn(ffmpegPath!, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const done = exitOf(proc);
    const write = (buf: Buffer) => new Promise<void>((res, rej) => proc.stdin.write(buf, (err) => (err ? rej(err) : res())));
    try {
      await write(cover);
      for (let i = 1; i < frames; i++) {
        await at(i / FPS);
        await write(await page.screenshot({ type: 'jpeg', quality: 90 }));
        if (i % (FPS * 5) === 0) progress(i / frames);
      }
      proc.stdin.end();
      await done;
    } finally {
      if (proc.exitCode === null) proc.kill();
    }
    return cover;
  });
}

function exitOf(proc: ReturnType<typeof spawn>): Promise<void> {
  const err: Buffer[] = [];
  proc.stderr?.on('data', (c: Buffer) => err.push(c));
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${Buffer.concat(err).toString().slice(-400)}`))));
  });
}

function ffmpeg(args: string[]): Promise<void> {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg no está disponible'));
  return exitOf(spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] }));
}

/** Seconds of an audio file (ffmpeg-static has no ffprobe: its banner says "Duration: 00:00:03.45"). */
export function durationOf(path: string): Promise<number> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(0);
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let text = '';
    proc.stderr.on('data', (c: Buffer) => (text += c.toString()));
    proc.on('close', () => {
      const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
    });
    proc.on('error', () => resolve(0));
  });
}

/** The two soft sounds of the chats, synthesized (no files, no cost): a message sent and one received. */
export async function chatSounds(dir: string): Promise<{ sent: string; received: string }> {
  const sent = join(dir, 'sent.wav');
  const received = join(dir, 'received.wav');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1320:duration=0.07', '-af', 'afade=t=in:d=0.005,afade=t=out:st=0.03:d=0.04,volume=0.5', sent]);
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.09', '-f', 'lavfi', '-i', 'sine=frequency=1175:duration=0.12',
    '-filter_complex', '[1:a]adelay=70|70[b];[0:a][b]amix=inputs=2:normalize=0,afade=t=out:st=0.1:d=0.08,volume=0.45', received]);
  return { sent, received };
}

/**
 * Mixes the narration clips (path, start), the effects (path, start, volume) and the music (looped,
 * ducked under the voice, faded out at the end) into one AAC track of exactly `total` seconds.
 */
export async function soundtrack(voice: [string, number][], effects: [string, number, number][], music: string | null, total: number, outPath: string, musicVolume = 0.2): Promise<void> {
  const inputs: string[] = [];
  const chains: string[] = [];
  const add = (path: string, loop = false) => {
    if (loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', path);
    return inputs.filter((x) => x === '-i').length - 1;
  };
  const fmt = 'aresample=44100,aformat=channel_layouts=stereo';
  const voiceLabels = voice.map(([path, start]) => {
    const i = add(path);
    const ms = Math.round(start * 1000);
    chains.push(`[${i}:a]${fmt},adelay=${ms}|${ms}[v${i}]`);
    return `[v${i}]`;
  });
  const fxLabels = effects.map(([path, start, vol]) => {
    const i = add(path);
    const ms = Math.round(start * 1000);
    chains.push(`[${i}:a]${fmt},volume=${vol},adelay=${ms}|${ms}[f${i}]`);
    return `[f${i}]`;
  });
  // With music the voice is split in two: one copy is heard, the other ducks the music (sidechain).
  if (voiceLabels.length) chains.push(`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0,apad,atrim=0:${total.toFixed(3)}${music ? ',asplit=2[voice][key]' : '[voice]'}`);
  const final: string[] = voiceLabels.length ? ['[voice]'] : [];
  if (music) {
    const i = add(music, true);
    const fade = Math.max(0, total - 2);
    chains.push(`[${i}:a]${fmt},atrim=0:${total.toFixed(3)},volume=${musicVolume},afade=t=in:d=0.8,afade=t=out:st=${fade.toFixed(3)}:d=2[m0]`);
    chains.push(voiceLabels.length ? '[m0][key]sidechaincompress=threshold=0.04:ratio=6:attack=40:release=500[music]' : '[m0]anull[music]');
    final.push('[music]');
  }
  final.push(...fxLabels);
  if (!final.length) chains.push(`anullsrc=r=44100:cl=stereo,atrim=0:${total.toFixed(3)}[out]`);
  else chains.push(`${final.join('')}amix=inputs=${final.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},alimiter=limit=0.9[out]`);
  await ffmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', outPath]);
}

export function mux(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  return ffmpeg(['-i', videoPath, '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', outPath]);
}

/** Any audio (fal returns WAV) → a light MP3 for the music library. */
export async function toMp3(input: string, outPath: string, seconds: number): Promise<void> {
  await ffmpeg(['-i', input, '-t', String(seconds), '-af', `afade=t=out:st=${Math.max(0, seconds - 1.5)}:d=1.5`, '-c:a', 'libmp3lame', '-b:a', '128k', outPath]);
}

export function workdir(): string {
  return mkdtempSync(join(tmpdir(), 'canix-promo-'));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function writeTemp(dir: string, name: string, data: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}
