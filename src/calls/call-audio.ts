import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { env } from '../config/env.js';

/**
 * Short-lived, unguessable public URLs for the natural-voice MP3 a call plays (TwiML <Play>):
 * Twilio fetches the audio itself once the call is answered, so it must be reachable over the
 * internet without our Bearer auth. Kept in memory only (single process - see
 * util/single-instance.ts) and dropped after AUDIO_TTL_MS, comfortably longer than ring timeout +
 * Twilio's fetch.
 */
const AUDIO_TTL_MS = 30 * 60_000;
const ROUTE = '/media/call-audio';
const store = new Map<string, { audio: Buffer; expiresAt: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of store) if (entry.expiresAt <= now) store.delete(token);
}

/** Public base URL Twilio can reach, or null when PANEL_URL isn't a public https URL. */
function publicBase(): string | null {
  const base = env.panelUrl.trim().replace(/\/$/, '');
  return /^https:\/\//i.test(base) ? base : null;
}

export function canServeCallAudio(): boolean {
  return publicBase() !== null;
}

/** Stores the MP3 and returns the URL Twilio should <Play>, or null if it can't be served. */
export function publishCallAudio(audio: Buffer): string | null {
  const base = publicBase();
  if (!base) return null;
  sweep();
  const token = randomBytes(24).toString('hex');
  store.set(token, { audio, expiresAt: Date.now() + AUDIO_TTL_MS });
  return `${base}${ROUTE}/${token}.mp3`;
}

export function registerCallAudioRoute(app: Express): void {
  app.get(`${ROUTE}/:file`, (req, res) => {
    const token = /^([a-f0-9]{48})\.mp3$/.exec(req.params.file)?.[1];
    const entry = token ? store.get(token) : undefined;
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(entry.audio);
  });
}
