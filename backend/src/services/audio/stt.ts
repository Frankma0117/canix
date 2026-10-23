import { existsSync } from 'node:fs';
import { Model, Recognizer, setLogLevel } from 'vosk-koffi';
import { env } from '../../config/env.js';

const SAMPLE_RATE = 16_000;

let model: InstanceType<typeof Model> | undefined;
let unavailable = false;

/** Lazily loads the Vosk model once. Returns undefined (and logs once) if it's not installed. */
function getModel(): InstanceType<typeof Model> | undefined {
  if (model) return model;
  if (unavailable) return undefined;

  if (!env.audio.voskModelPath || !existsSync(env.audio.voskModelPath)) {
    console.log(
      '[STT] Vosk model not found at "%s" - voice-note transcription is off. ' +
        'Download one (e.g. vosk-model-small-es-0.42) from https://alphacephei.com/vosk/models and point VOSK_MODEL_PATH to it.',
      env.audio.voskModelPath,
    );
    unavailable = true;
    return undefined;
  }

  try {
    setLogLevel(-1); // silence Kaldi's own logging
    model = new Model(env.audio.voskModelPath);
    console.log('[STT] Vosk model loaded from "%s".', env.audio.voskModelPath);
    return model;
  } catch (err) {
    console.error('[STT] Could not load the Vosk model:', (err as Error).message);
    unavailable = true;
    return undefined;
  }
}

/**
 * vosk-koffi's types claim finalResult() always returns { alternatives: [...] }, but the native
 * Vosk library only nests results under "alternatives" when setMaxAlternatives() was called -
 * without it (our case), it returns a flat { text, result, confidence } instead. Read both shapes
 * defensively rather than trusting the (inaccurate here) declared type.
 */
interface VoskFinalResult {
  text?: string;
  alternatives?: { text?: string }[];
}

/**
 * Transcribes raw 16kHz mono PCM16 audio (see services/audio/ffmpeg.ts) to text using a local Vosk model.
 * Returns null when the model isn't installed or nothing intelligible was recognized.
 */
export function transcribePcm(pcm: Buffer): string | null {
  const m = getModel();
  if (!m) return null;

  const rec = new Recognizer({ model: m, sampleRate: SAMPLE_RATE });
  try {
    rec.acceptWaveform(pcm);
    const result = rec.finalResult() as unknown as VoskFinalResult;
    const text = (result.text ?? result.alternatives?.[0]?.text)?.trim();
    return text || null;
  } finally {
    rec.free();
  }
}
