import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { wavToOggOpus } from './ffmpeg.js';

let unavailableLogged = false;

// Emoji/pictographs (👍🎉📞 etc.) plus the invisible joiner/variation-selector/keycap codepoints
// that ride along with compound ones (needed for things like the "1️⃣" digit-in-a-box emoji used in
// the menu - it's the digit '1' + U+FE0F + U+20E3, and the digit itself must survive), and
// WhatsApp's markdown punctuation (*bold*, _italic_, ~strikethrough~, `code`) - none of that is
// meant to be spoken, Piper just reads it as "asterisco"/mangled noise otherwise (see the user's
// own report). Built from explicit code points rather than pasting the invisible characters
// literally into this file's source.
const ZERO_WIDTH_JOINER = String.fromCharCode(0x200d);
const VARIATION_SELECTOR_16 = String.fromCharCode(0xfe0f);
const COMBINING_KEYCAP = String.fromCharCode(0x20e3);
const UNSPEAKABLE_RE = new RegExp(
  `[\\p{Extended_Pictographic}${ZERO_WIDTH_JOINER}${VARIATION_SELECTOR_16}${COMBINING_KEYCAP}*_~\`]`,
  'gu',
);

/** Strips everything from a chat reply that reads fine on screen but sounds wrong out loud - see
 *  UNSPEAKABLE_RE - and collapses the line breaks a WhatsApp message uses for visual structure
 *  (list items, paragraph breaks) into spoken pauses instead of Piper reading them as silence/one
 *  run-on sentence. */
function sanitizeForSpeech(text: string): string {
  return text
    .replace(UNSPEAKABLE_RE, '')
    .replace(/\n+/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

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
  const trimmed = sanitizeForSpeech(text);
  if (!trimmed) return null;

  const outFile = join(tmpdir(), `canix-tts-${randomUUID()}.wav`);
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
