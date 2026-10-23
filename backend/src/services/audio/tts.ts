import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { wavToOggOpus } from './ffmpeg.js';
import { fishTts } from './fish-audio.js';
import { fishVoiceId } from './voices.js';
import { aiUsageModel } from '../../models/ai-usage.model.js';
import { stripInternalRefs } from '../../shared/utils/wa-format.js';

let unavailableLogged = false;
let femaleUnavailableLogged = false;

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
export function sanitizeForSpeech(text: string): string {
  return stripInternalRefs(text)
    .replace(UNSPEAKABLE_RE, '')
    .replace(/\n+/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Picks which Piper voice model file to use for this reply, based on the user's stored
 * preference (see users.voice_gender / set-voice-gender.tool.ts). 'female' only wins when
 * PIPER_VOICE_PATH_FEMALE is actually configured and exists - otherwise (unset, missing file, or
 * no preference/'male') this silently falls back to the default PIPER_VOICE_PATH, so a caller
 * never needs to branch on whether the female voice happens to be set up.
 */
function resolveVoicePath(voiceGender: 'male' | 'female' | null | undefined): string {
  const { voicePath, voicePathFemale } = env.audio.piper;
  if (voiceGender === 'female') {
    if (voicePathFemale && existsSync(voicePathFemale)) return voicePathFemale;
    if (!femaleUnavailableLogged) {
      console.log(
        '[TTS] A female voice was requested but PIPER_VOICE_PATH_FEMALE is not set or does not exist - ' +
          'using the default voice. Download a Spanish voice from https://huggingface.co/rhasspy/piper-voices.',
      );
      femaleUnavailableLogged = true;
    }
  }
  return voicePath;
}

function piperReady(voicePath: string): boolean {
  const { binPath } = env.audio.piper;
  if (!binPath || !voicePath || !existsSync(binPath) || !existsSync(voicePath)) {
    if (!unavailableLogged) {
      console.log(
        '[TTS] Piper is not configured (PIPER_BIN_PATH/PIPER_VOICE_PATH) - voice replies are ' +
          'off. Download the binary from https://github.com/rhasspy/piper/releases and a Spanish voice ' +
          'from https://huggingface.co/rhasspy/piper-voices.',
      );
      unavailableLogged = true;
    }
    return false;
  }
  return true;
}

function runPiper(text: string, voicePath: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { binPath } = env.audio.piper;
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

export interface VoiceNoteOptions {
  /** The user has the paid 'voice.premium' permission -> try Fish Audio's natural voice first. */
  premium?: boolean;
  /** Whose usage this is (logged to ai_usage for future billing). */
  userId?: number;
  /** The natural voice this person chose (users.voice_id, see services/audio/voices.ts) - premium only. */
  voiceId?: string | null;
}

/**
 * Synthesizes text into a WhatsApp-ready voice note (ogg/opus). With `premium`, uses Fish Audio's
 * natural voice (see services/audio/fish-audio.ts) - paid per character, so only for users holding the
 * 'voice.premium' permission, and only for replies up to FISH_AUDIO_MAX_CHARS (a longer one returns
 * null so the caller sends text instead of a long, costly note). Otherwise, or if Fish fails, the
 * local Piper voice (free, no tokens). `voiceGender` picks the voice (users.voice_gender). Returns
 * null when nothing could be synthesized - callers then fall back to the text reply.
 */
export async function synthesizeVoiceNote(
  text: string,
  voiceGender?: 'male' | 'female' | null,
  opts: VoiceNoteOptions = {},
): Promise<Buffer | null> {
  const trimmed = sanitizeForSpeech(text);
  if (!trimmed) return null;

  if (opts.premium) {
    if (trimmed.length > env.audio.fish.maxChars) {
      console.log('[TTS] Reply of %d characters > FISH_AUDIO_MAX_CHARS (%d) - sent as text.', trimmed.length, env.audio.fish.maxChars);
      return null;
    }
    const mp3 = await fishTts(trimmed, fishVoiceId({ voice_id: opts.voiceId ?? null, voice_gender: voiceGender ?? null, gender: null }));
    if (mp3) {
      if (opts.userId) {
        try {
          aiUsageModel.log(opts.userId, 'voice.fish', env.audio.fish.model, trimmed.length, 0);
        } catch (err) {
          console.error('[TTS] Could not record voice usage:', (err as Error).message);
        }
      }
      try {
        return await wavToOggOpus(mp3); // ffmpeg autodetects the input container - mp3 works too
      } catch (err) {
        console.error('[TTS] Error converting Fish audio to ogg:', (err as Error).message);
      }
    }
  }

  const voicePath = resolveVoicePath(voiceGender);
  if (!piperReady(voicePath)) return null;

  const outFile = join(tmpdir(), `canix-tts-${randomUUID()}.wav`);
  try {
    await runPiper(trimmed, voicePath, outFile);
    const wav = await readFile(outFile);
    return await wavToOggOpus(wav);
  } catch (err) {
    console.error('[TTS] Error generating audio:', (err as Error).message);
    return null;
  } finally {
    await unlink(outFile).catch(() => {});
  }
}
