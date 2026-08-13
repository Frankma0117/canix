import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { wavToOggOpus } from './ffmpeg.js';

let unavailableLogged = false;

function piperReady(): boolean {
  const { binPath, voicePath } = env.audio.piper;
  if (!binPath || !voicePath || !existsSync(binPath) || !existsSync(voicePath)) {
    if (!unavailableLogged) {
      console.log(
        '[TTS] Piper no esta configurado (PIPER_BIN_PATH/PIPER_VOICE_PATH) - las respuestas de voz estan ' +
          'desactivadas. Descarga el binario de https://github.com/rhasspy/piper/releases y una voz en espanol ' +
          'de https://huggingface.co/rhasspy/piper-voices.',
      );
      unavailableLogged = true;
    }
    return false;
  }
  return true;
}

function runPiper(text: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { binPath, voicePath } = env.audio.piper;
    const proc = spawn(binPath, ['--model', voicePath, '--output_file', outFile]);
    const errChunks: Buffer[] = [];
    proc.stderr.on('data', (c: Buffer) => errChunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper salio con codigo ${code}: ${Buffer.concat(errChunks).toString().slice(0, 500)}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/**
 * Synthesizes text into a WhatsApp-ready voice note (ogg/opus) using a local Piper voice - no
 * AI/tokens involved. Returns null when Piper isn't installed/configured; this is always a
 * best-effort extra on top of the text reply, never something a caller should block on.
 */
export async function synthesizeVoiceNote(text: string): Promise<Buffer | null> {
  if (!piperReady()) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const outFile = join(tmpdir(), `cania-tts-${randomUUID()}.wav`);
  try {
    await runPiper(trimmed, outFile);
    const wav = await readFile(outFile);
    return await wavToOggOpus(wav);
  } catch (err) {
    console.error('[TTS] Error generando audio:', (err as Error).message);
    return null;
  } finally {
    await unlink(outFile).catch(() => {});
  }
}
