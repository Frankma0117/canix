import { env } from '../config/env.js';

let missingKeyLogged = false;

export function isFishConfigured(): boolean {
  return !!env.audio.fish.apiKey;
}

/**
 * Text -> MP3 with a natural voice through Fish Audio (https://docs.fish.audio). Returns null on any
 * failure (no key, HTTP error, timeout) so callers can fall back to local Piper - a paid extra must
 * never be the reason a reply is lost. Never logs the API key or the full text.
 */
export async function fishTts(text: string, voiceGender: 'male' | 'female' | null | undefined): Promise<Buffer | null> {
  const { apiKey, model, voiceMale, voiceFemale, timeoutMs } = env.audio.fish;
  if (!apiKey) {
    if (!missingKeyLogged) {
      console.log('[TTS] FISH_AUDIO_API_KEY no configurada - uso Piper (voz local).');
      missingKeyLogged = true;
    }
    return null;
  }
  const started = Date.now();
  try {
    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', model },
      body: JSON.stringify({
        text,
        reference_id: voiceGender === 'female' ? voiceFemale : voiceMale,
        format: 'mp3',
        mp3_bitrate: 64, // voice notes: 64kbps is indistinguishable on a phone and half the bytes
        latency: 'balanced',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      console.error('[TTS] Fish Audio respondió %d: %s', res.status, detail);
      return null;
    }
    const audio = Buffer.from(await res.arrayBuffer());
    console.log('[TTS] Fish Audio: %d caracteres -> %d bytes en %dms', text.length, audio.length, Date.now() - started);
    return audio.length ? audio : null;
  } catch (err) {
    console.error('[TTS] Fish Audio falló (%dms): %s', Date.now() - started, (err as Error).message);
    return null;
  }
}
