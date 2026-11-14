import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../../config/env.js';
import { fishTts, isFishConfigured } from './fish-audio.js';
import { aiUsageModel } from '../../models/ai-usage.model.js';
import type { User } from '../../entities/index.js';

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
  { key: 'H11', gender: 'male', name: 'Rodrigo', style: 'locutor grave y profesional', id: '3f45a7fd7a614655a61eb7027b955783' },
  { key: 'H12', gender: 'male', name: 'Ricardo', style: 'locutor publicitario, seguro', id: 'a1fe2e1b6f324e27929d5088f2d09be3' },
  { key: 'H13', gender: 'male', name: 'Néstor', style: 'locutor profundo, de anuncio', id: 'def180b161a3498db94025d5124fcb2a' },
  { key: 'H14', gender: 'male', name: 'Adrián', style: 'narrador de historias, cercano', id: '9deec9a061894a93a133d2bf45d2e4c0' },
  { key: 'H15', gender: 'male', name: 'Javier', style: 'mexicano, narrador claro', id: 'b0e04de04f6e4ace8deee82fa6d121e5' },
  { key: 'H16', gender: 'male', name: 'Esteban', style: 'enérgico, de publicidad', id: '9a831a5fafd04c9aab68d248a32fa5b2' },
  { key: 'M11', gender: 'female', name: 'Natalia', style: 'joven, educativa y cercana', id: '35929683c49c4ec0bf779dc07d22620b' },
  { key: 'M12', gender: 'female', name: 'Carolina', style: 'narradora de voz profunda', id: 'bfed5c0810a347dbb62e8ccce7f59c48' },
  { key: 'M13', gender: 'female', name: 'Alejandra', style: 'profesional, de publicidad', id: '70fb19852a484f3eb1d040423e2a8be7' },
  { key: 'M14', gender: 'female', name: 'Fernanda', style: 'mexicana, educativa y clara', id: 'b806a84350454df0af0b86f930f36915' },
  { key: 'M15', gender: 'female', name: 'Ximena', style: 'mexicana, cálida y conversacional', id: '561fe660218349598b7570bab1c8148b' },
  { key: 'M16', gender: 'female', name: 'Catalina', style: 'colombiana, enérgica, de anuncio', id: '0051425f78064482b3a75146feec8651' },
  // 2026-11-14: more generic library voices (checked trained + public; no real people, no characters).
  { key: 'H17', gender: 'male', name: 'Emilio', style: 'narrador solemne y sereno', id: '8d2c17a9b26d4d83888ea67a1ee565b2' },
  { key: 'H18', gender: 'male', name: 'Bruno', style: 'enérgico, de redes sociales', id: 'a335d470fff248e8890dce6550a2874b' },
  { key: 'H19', gender: 'male', name: 'Joaquín', style: 'narrador sereno y amable', id: 'f53102becdf94a51af6d64010bc658f2' },
  { key: 'H20', gender: 'male', name: 'Ignacio', style: 'sabio y cálido, educativo', id: '60a33602dacc4d899cb671b024e66d8c' },
  { key: 'H21', gender: 'male', name: 'Martín', style: 'grave, pausado y elegante', id: 'dc0746cd45dd40deb6bca32dc87fd7f5' },
  { key: 'H22', gender: 'male', name: 'Gonzalo', style: 'publicitario de voz profunda', id: 'd6cc48df129d45b18d5fe1afb76c1a92' },
  { key: 'H23', gender: 'male', name: 'Diego', style: 'conversacional, de redes', id: '3399c2a4aa4e470b8adaaa2e4842ec12' },
  { key: 'H24', gender: 'male', name: 'Hernán', style: 'cuentacuentos expresivo', id: '9be3e6c74a084848a47f3778cffeaed2' },
  { key: 'H25', gender: 'male', name: 'Álvaro', style: 'documental y profesional', id: 'ac594943984a47e7a827416eb263c7b1' },
  { key: 'H26', gender: 'male', name: 'Marcos', style: 'documental y claro', id: '93dc4e3a1a494d58ad0f50f712b8b152' },
  { key: 'H27', gender: 'male', name: 'Gaspar', style: 'grave, amigable y expresivo', id: '3e41879b20a74cdca139a0e0a7d31d2c' },
  { key: 'H28', gender: 'male', name: 'Raúl', style: 'de noticiero, serio', id: '05100dcc9dfd4af49ea96dc5affbe5b1' },
  { key: 'H29', gender: 'male', name: 'Lucas', style: 'argentino, claro y seguro', id: 'f2a8c8e905d242859e8a3de2db575bef' },
  { key: 'H30', gender: 'male', name: 'Matías', style: 'chileno, seguro y enérgico', id: '7dd2ab68aced4969a162069d435cf744' },
  { key: 'M17', gender: 'female', name: 'Valeria', style: 'amigable y luminosa', id: 'c11e80c135c3432a95d54519f43a2519' },
  { key: 'M18', gender: 'female', name: 'Renata', style: 'alegre y conversacional', id: '286d076a6477415b8658499110a3ae13' },
  { key: 'M19', gender: 'female', name: 'Susana', style: 'suave, calmada y clara', id: 'a644b18dd74d4bc9a775398069fa459d' },
  { key: 'M20', gender: 'female', name: 'Andrea', style: 'cálida y amigable', id: 'd516b7839eb74f4da0bb1677e94127d0' },
  { key: 'M21', gender: 'female', name: 'Celia', style: 'entusiasta y enérgica', id: '744589ecce9e4364ae8edc8c48111352' },
  { key: 'M22', gender: 'female', name: 'Inés', style: 'íntima y suave', id: 'b6d5c6fb554b4b23a80f384e0b08700a' },
  { key: 'M23', gender: 'female', name: 'Carmen', style: 'profesional y segura', id: '3f065d660212478a9c697fa965b4d098' },
  { key: 'M24', gender: 'female', name: 'Verónica', style: 'locutora suave y profesional', id: 'a1070fc5bc824bb79dfa0007c00dfd0f' },
  { key: 'M25', gender: 'female', name: 'Lucía', style: 'publicitaria y enérgica', id: '5e816f5a0658460b960881a24733c418' },
  { key: 'M26', gender: 'female', name: 'Antonia', style: 'dulce y cálida', id: '779cbebcb4c04e74b73080a44bc98358' },
  { key: 'M27', gender: 'female', name: 'Elena', style: 'natural y profunda, narradora', id: 'edbe850c6b7d40f195edd8c043b18748' },
  { key: 'M28', gender: 'female', name: 'Rosa', style: 'suave y cercana', id: 'eaadef28d69a4a10b80436d28634115c' },
  { key: 'M29', gender: 'female', name: 'Lorena', style: 'educativa y animada', id: '48bf0ac7af8b4c4ebb9d894301dcc5ae' },
  { key: 'M30', gender: 'female', name: 'Manuela', style: 'juvenil y cálida', id: '8ab964fc63cd49a498f862333cb5b18f' },
  { key: 'M31', gender: 'female', name: 'Pilar', style: 'colombiana, dulce y tranquila', id: '601f09c4607f4c4da5b3486b28346e04' },
  { key: 'M32', gender: 'female', name: 'Luisa', style: 'paisa, alegre y conversadora', id: 'f188d9cdf8ef4b58bef6b2f791ba049d' },
  // Voices Aula Interactiva already used (Mexico, Argentina, Chile, Venezuela...): the catalog is shared.
  { key: 'M33', gender: 'female', name: 'Guadalupe', style: 'mexicana, locutora profesional y segura', id: 'fc67d827e8384a2a9ca13bf0b0162b2a' },
  { key: 'M34', gender: 'female', name: 'Regina', style: 'mexicana, ágil y amigable', id: '795ec40a01914c95b2b1b5c93d646d6e' },
  { key: 'M35', gender: 'female', name: 'Mariela', style: 'venezolana, profesional y amable', id: '22550e2d849b44e18c7df57f61e666f9' },
  { key: 'M36', gender: 'female', name: 'Florencia', style: 'argentina, cálida y relajada', id: '55589185654d4d5abc1035280611fb65' },
  { key: 'M37', gender: 'female', name: 'Agustina', style: 'argentina, joven, clara y amable', id: 'e5c2cf742d864a288e63a97774b727e4' },
  { key: 'M38', gender: 'female', name: 'Javiera', style: 'chilena, alegre y cálida', id: 'dfd23dbaf3a04dd2b358d3ab44ecf15f' },
  { key: 'M39', gender: 'female', name: 'Amparo', style: 'de abuela, cálida y maternal', id: '69b15625e49546f8a3f465d31610f0bc' },
  { key: 'H31', gender: 'male', name: 'Ramiro', style: 'narrador latino, calmado', id: 'a508e76ec74e4b57ad77d907992a536e' },
  { key: 'H32', gender: 'male', name: 'Óscar', style: 'de profesor, calmado y claro', id: '785d81f7fff943849fc0f077212f7cbd' },
  { key: 'H33', gender: 'male', name: 'Ernesto', style: 'narrador de cuentos, grave y cálido', id: '0f1c18ccc09541c398c2f28f9516c78d' },
  { key: 'H34', gender: 'male', name: 'Fabián', style: 'narrador documental, sereno', id: '8b7187104e32481bb675f0cca0b0a002' },
  { key: 'H35', gender: 'male', name: 'Daniel', style: 'joven, casual y animado', id: 'd1f70e33cb26469195a5a113e336c202' },
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
function defaultVoice(gender: 'male' | 'female' | null | undefined): VoiceOption | undefined {
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

const sampleDir = join(dirname(env.db.path), 'voice-samples');
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
    if (requestedBy) aiUsageModel.log(requestedBy, 'voice.fish.sample', env.audio.fish.model, text.length, 0);
  } catch (err) {
    console.error('[TTS] Could not save the sample of voice %s:', v.key, (err as Error).message);
  }
  return mp3;
}
