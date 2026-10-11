import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { fishTts, isFishConfigured } from './fish-audio.js';
import { aiUsageRepo } from '../db/repositories/ai-usage.repo.js';
import type { User } from '../types/index.js';

/**
 * The natural voices (Fish Audio voice library) a person with the paid 'voice.premium' permission
 * can choose from - all Spanish, Colombian or neutral, and none a clone of a real, recognizable
 * person (the library is full of singers and politicians: never add those). `id` is the Fish
 * "reference_id". To add one: listen to it on fish.audio, copy its id, add a row. `key` is what
 * gets stored in users.voice_id, so never reuse or renumber an existing key.
 */
export interface VoiceOption {
  key: string;
  gender: 'male' | 'female';
  name: string;
  style: string;
  id: string;
}

export const VOICES: VoiceOption[] = [
  { key: 'H1', gender: 'male', name: 'Mateo', style: 'cálido y enérgico', id: 'b46654f2e3ef4f48b5f7c9d22ae3f921' },
  { key: 'H2', gender: 'male', name: 'Andrés', style: 'relajado y suave', id: 'c943469bcc194734ac1a09d083cb1062' },
  { key: 'H3', gender: 'male', name: 'Santiago', style: 'bogotano, calmado y claro', id: 'e3ce51cfea59447b8ce2c63b3b681e31' },
  { key: 'H4', gender: 'male', name: 'Camilo', style: 'sereno, de narrador', id: 'da13e1b3f87c4f40b8090d0fd6454921' },
  { key: 'H5', gender: 'male', name: 'Pedro', style: 'neutro', id: '17ed67335f0145c9a850fddecd3c40e0' },
  { key: 'H6', gender: 'male', name: 'Julián', style: 'claro y seguro, de asistente', id: 'de3042eb048a4d37baf2e61d10183e23' },
  { key: 'H7', gender: 'male', name: 'Nicolás', style: 'joven, claro y profesional', id: 'c7a15a61f379424ca773a8eda073fdf0' },
  { key: 'H8', gender: 'male', name: 'Sebastián', style: 'juvenil y amigable', id: 'b861ebdd5bfc4e4ca1d8dc967bc56eac' },
  { key: 'H9', gender: 'male', name: 'Felipe', style: 'conversacional y animado', id: '4aa3bdb4a90449dfbd7aba351b288858' },
  { key: 'H10', gender: 'male', name: 'Tomás', style: 'grave, cálido y pausado', id: '51aead15fd23476291a10b5ccf7ab8fb' },
  { key: 'M1', gender: 'female', name: 'Valentina', style: 'joven y amigable', id: '08ecaf85075041fc9aa66698ae430dc4' },
  { key: 'M2', gender: 'female', name: 'Camila', style: 'conversacional y expresiva', id: '84a980d0ef3d4f8ea185951bd920afbe' },
  { key: 'M3', gender: 'female', name: 'Laura', style: 'clara y profesional', id: 'f186d3dafbd244eca689a212b5ba0269' },
  { key: 'M4', gender: 'female', name: 'Daniela', style: 'paisa, suave y cercana', id: '10509ddabaaf48089ad5cf2d1b1eaf1d' },
  { key: 'M5', gender: 'female', name: 'Sofía', style: 'cálida, de narradora', id: 'e296306da5d449999f6e35c2b9f60aea' },
  { key: 'M6', gender: 'female', name: 'Isabela', style: 'clara y segura, de asistente', id: 'fb9d5855f185451983404deb10788ad4' },
  { key: 'M7', gender: 'female', name: 'Mariana', style: 'calmada y pausada', id: 'f95998e46fdb4bd4aefe591c312b72a4' },
  { key: 'M8', gender: 'female', name: 'Gabriela', style: 'clara y cálida', id: 'c5db0dd415bd4521a5c3c36372a4c464' },
  { key: 'M9', gender: 'female', name: 'Paula', style: 'paisa, expresiva y amigable', id: 'e8ffb4ccb56a4eb0b1d85b57f2f45a47' },
  { key: 'M10', gender: 'female', name: 'Juliana', style: 'enérgica y profesional', id: '14909251a5064426ab1ae84cdbb4aeac' },
];

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Finds a voice by its code ("M3", "m 3") or its name ("Laura"). */
export function findVoice(query: string | null | undefined): VoiceOption | undefined {
  if (!query) return undefined;
  const q = norm(query).replace(/\s+/g, '');
  return VOICES.find((v) => norm(v.key) === q) ?? VOICES.find((v) => norm(v.name) === q) ?? VOICES.find((v) => q.includes(norm(v.name)));
}

/** The voice used for someone who hasn't chosen one: the configured default for their gender. */
export function defaultVoice(gender: 'male' | 'female' | null | undefined): VoiceOption | undefined {
  const id = gender === 'female' ? env.audio.fish.voiceFemale : env.audio.fish.voiceMale;
  return VOICES.find((v) => v.id === id);
}

/** Fish reference_id for this person: the voice they chose, else their gender's default. */
export function fishVoiceId(user: Pick<User, 'voice_id' | 'voice_gender' | 'gender'> | undefined): string {
  const chosen = findVoice(user?.voice_id);
  if (chosen) return chosen.id;
  return (user?.voice_gender ?? user?.gender) === 'female' ? env.audio.fish.voiceFemale : env.audio.fish.voiceMale;
}

/** The voice this person currently hears (undefined only if the env default isn't in the catalog). */
export function currentVoice(user: Pick<User, 'voice_id' | 'voice_gender' | 'gender'>): VoiceOption | undefined {
  return findVoice(user.voice_id) ?? defaultVoice(user.voice_gender ?? user.gender);
}

export function describeVoice(v: VoiceOption): string {
  return `${v.key} · ${v.name} (${v.gender === 'female' ? 'mujer' : 'hombre'}, ${v.style})`;
}

/** The catalog as a WhatsApp message, marking the one in use. */
export function voiceListMessage(current: VoiceOption | undefined): string {
  const block = (gender: 'male' | 'female') =>
    VOICES.filter((v) => v.gender === gender)
      .map((v) => `• *${v.key}* — ${v.name}: ${v.style}${current?.key === v.key ? ' ✅ _(la que tienes)_' : ''}`)
      .join('\n');
  return (
    `🎙️ *Voces disponibles*\n\n*Hombre*\n${block('male')}\n\n*Mujer*\n${block('female')}\n\n` +
    'Dime cuál quieres oír (ej. "muéstrame M3") y te mando una muestra, o cuál dejar (ej. "deja a Laura").'
  );
}

const sampleDir = join(dirname(resolve(process.cwd(), env.db.path)), 'voice-samples');
const sampleText = (v: VoiceOption) => `Hola, soy ${v.name}. Así sueno cuando Canix te responde con una nota de voz.`;

/**
 * A short MP3 of one voice introducing itself, for choosing by ear. Generated through Fish once
 * per voice and kept on disk (data/voice-samples), so previews cost nothing after the first time.
 * null when Fish isn't configured or the request failed.
 */
export async function voiceSample(v: VoiceOption, requestedBy?: number): Promise<Buffer | null> {
  const file = join(sampleDir, `${v.key}-${v.id.slice(0, 8)}.mp3`);
  if (existsSync(file)) return readFile(file);
  if (!isFishConfigured()) return null;
  const text = sampleText(v);
  const mp3 = await fishTts(text, v.id);
  if (!mp3) return null;
  try {
    mkdirSync(sampleDir, { recursive: true });
    await writeFile(file, mp3);
    if (requestedBy) aiUsageRepo.log(requestedBy, 'voice.fish.sample', env.audio.fish.model, text.length, 0);
  } catch (err) {
    console.error('[TTS] No pude guardar la muestra de la voz %s:', v.key, (err as Error).message);
  }
  return mp3;
}
