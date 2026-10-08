import { stickersRepo } from '../db/repositories/stickers.repo.js';
import type { Sticker } from '../types/index.js';

/**
 * Every sticker the bot sends comes from the admin's own pack (see stickers.repo.ts and the upload
 * flow in bot-manager.ts) - nothing is ever generated. This used to fall back to ffmpeg-rendered
 * abstract gradient "badges" for the completion celebration, which looked like random colored
 * blobs next to the admin's real stickers; if no saved sticker fits a moment, no sticker is sent.
 */

/** Matched against labels with accents/underscores/spaces ignored (see findByKeywords) - partial
 *  stems on purpose ("felicit" covers felicitaciones/felicitar, "celebr" covers celebrar/
 *  celebracion), so whatever name the admin gave a "did it!" sticker is likely to be found.
 *  Generic "well done" - shared by both completion lists below. */
const CELEBRATION_KEYWORDS = [
  'celebr',
  'felicid',
  'felicit',
  'bienhecho',
  'logr',
  'exito',
  'aplaus',
  'bravo',
  'genial',
  'victoria',
  'festej',
  'fiesta',
  'excelente',
  'campeon',
  'trofeo',
  'orgullo',
  'yay',
  'congrat',
  'welldone',
  'muybien',
] as const;

/** complete_todo: generic celebration plus task-specific names ("tarea_completada", "hecho",
 *  "todo_listo") - never a routine-specific one like "habito_completado". */
export const TODO_DONE_KEYWORDS = [...CELEBRATION_KEYWORDS, 'tareacomplet', 'hecho', 'todolisto'] as const;

/** checkin_routine: generic celebration plus habit-specific names ("habito_completado",
 *  "la_constancia_es_clave") - never a task-specific one like "tarea_completada". */
export const ROUTINE_DONE_KEYWORDS = [...CELEBRATION_KEYWORDS, 'habitocomplet', 'rutinacomplet', 'constancia'] as const;

/** Close of the day (last pending item done, see agenda.ts's maybeNightFarewell) - includes a
 *  "dia_productivo_completado"-style sticker, which only fits here, not on every completion. */
export const NIGHT_KEYWORDS = ['noche', 'goodnight', 'dulcessuenos', 'adormir', 'diaproductivo'] as const;

/**
 * Minimum gap between two stickers to the same chat - completing five tasks in a row shouldn't
 * produce five stickers (or the AI's own send_sticker doubling the automatic celebration in the
 * same turn). In-memory on purpose: a restart resetting it is harmless.
 */
const STICKER_COOLDOWN_MS = 5 * 60_000;
const lastStickerAt = new Map<string, number>();

export function stickerOnCooldown(jid: string): boolean {
  const last = lastStickerAt.get(jid);
  return last !== undefined && Date.now() - last < STICKER_COOLDOWN_MS;
}

interface StickerSender {
  sendSticker(jid: string, webp: Buffer): Promise<void>;
}

/** Sends one pack sticker and starts the cooldown. Throws if the send fails (cooldown untouched). */
export async function sendPackSticker(wa: StickerSender, jid: string, sticker: Sticker): Promise<void> {
  await wa.sendSticker(jid, sticker.data);
  lastStickerAt.set(jid, Date.now());
  console.log('[STICKER] Enviado "%s" (#%d) a %s.', sticker.label, sticker.id, jid);
}

/**
 * Best-effort automatic sticker for a moment the code (not the AI) detected - a completion, the
 * close of the day. Picks from the pack by keyword; does nothing when no saved sticker matches or
 * one went out to this chat recently (unless `force`, used for the once-a-day "buenas noches").
 * Never throws - callers fire-and-forget it alongside their text reply.
 */
export function sendAutoSticker(
  wa: StickerSender,
  jid: string,
  keywords: readonly string[],
  opts: { force?: boolean } = {},
): void {
  if (!opts.force && stickerOnCooldown(jid)) return;
  let sticker: Sticker | undefined;
  try {
    sticker = stickersRepo.findByKeywords([...keywords]);
  } catch (err) {
    console.error('[STICKER] Error buscando sticker:', (err as Error).message);
    return;
  }
  if (!sticker) return;
  sendPackSticker(wa, jid, sticker).catch((err) => {
    console.error('[STICKER] No se pudo enviar "%s":', sticker!.label, (err as Error).message);
  });
}
