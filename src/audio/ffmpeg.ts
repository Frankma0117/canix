import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// ffmpeg-static is CommonJS with a plain `module.exports = <path>`; under NodeNext module
// resolution TS's ESM default-import interop for it resolves to the wrong (namespace) type, so
// load it directly via require instead of fighting the type resolution.
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

function runFfmpeg(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static no proveyo un binario para esta plataforma'));
      return;
    }
    const proc = spawn(ffmpegPath, args);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => errChunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg salio con codigo ${code}: ${Buffer.concat(errChunks).toString().slice(0, 500)}`));
    });
    proc.stdin.on('error', () => {
      /* ffmpeg may close stdin early on invalid input - the 'close' handler above reports the real error */
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * Converts an arbitrary audio buffer (WhatsApp voice notes are ogg/opus) to raw 16kHz mono
 * PCM16 (no WAV header) - the format Vosk expects.
 */
export function toPcm16Mono16k(input: Buffer): Promise<Buffer> {
  return runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'],
    input,
  );
}

/** Converts a WAV buffer (e.g. Piper's output) into Ogg/Opus, the format WhatsApp expects for voice notes (ptt). */
export function wavToOggOpus(wav: Buffer): Promise<Buffer> {
  return runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'libopus', '-ar', '48000', '-ac', '1', '-f', 'ogg', 'pipe:1'],
    wav,
  );
}
