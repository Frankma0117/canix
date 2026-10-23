import { stickersModel, type StickerMeta } from '../../models/stickers.model.js';
import { nowLocal } from '../../shared/utils/datetime.js';
import { STICKER_MOMENTS, suggestMoments } from './sticker-moments.js';
import type { Sticker } from '../../entities/index.js';

/**
 * When and which sticker goes out. Every sticker comes from the admin's own pack - nothing is
 * generated. The code sends one on its own for the moments it can detect (an action that just
 * succeeded, a greeting, thanks, a completed routine, the close of the day) and the agent may send
 * one for other moments (send_sticker). Which stickers fit a moment is set per sticker in the
 * portal (Stickers); until it is, it's suggested from the sticker's name. Among the stickers that
 * fit, the least recently sent goes out, so a big pack rotates instead of repeating the same few.
 */

/** Minimum gap between two stickers to the same chat - five tasks done in a row shouldn't bring
 *  five stickers. In memory on purpose: a restart resetting it is harmless. */
const STICKER_COOLDOWN_MS = 2 * 60_000;
const lastStickerAt = new Map<string, number>();

export function stickerOnCooldown(jid: string): boolean {
  const last = lastStickerAt.get(jid);
  return last !== undefined && Date.now() - last < STICKER_COOLDOWN_MS;
}

interface StickerSender {
  sendSticker(jid: string, webp: Buffer): Promise<void>;
}

/** The moments a sticker fits: the ones the admin chose, or the ones its name suggests. */
export function momentsOf(sticker: Pick<StickerMeta, 'label' | 'moments'>): string[] {
  if (sticker.moments) {
    try {
      const parsed = JSON.parse(sticker.moments) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* corrupt value - fall back to the suggestion */
    }
  }
  return suggestMoments(sticker.label);
}

/** The least recently sent usable sticker for a moment (never-sent first, random among ties). */
function pickForMoment(moment: string): Sticker | undefined {
  const fits = stickersModel.listUsable().filter((s) => momentsOf(s).includes(moment));
  if (fits.length === 0) return undefined;
  const oldest = fits.reduce((min, s) => ((s.last_sent_at ?? '') < (min.last_sent_at ?? '') ? s : min), fits[0]);
  const ties = fits.filter((s) => (s.last_sent_at ?? '') === (oldest.last_sent_at ?? ''));
  return stickersModel.getById(ties[Math.floor(Math.random() * ties.length)].id);
}

/** Sends one pack sticker, records it for the rotation and starts the cooldown. Throws if the send fails. */
export async function sendPackSticker(wa: StickerSender, jid: string, sticker: Sticker): Promise<void> {
  // Counted when chosen, so stickers picked at the same time still rotate.
  stickersModel.markSent(sticker.id);
  await wa.sendSticker(jid, sticker.data);
  lastStickerAt.set(jid, Date.now());
  console.log('[STICKER] Sent "%s" (#%d) to %s.', sticker.label, sticker.id, jid);
}

/**
 * Best-effort sticker for a moment the code detected. Does nothing when no sticker fits the moment
 * or one went out to this chat recently (unless `force`, used for the once-a-day good night).
 * Never throws - callers fire-and-forget it alongside their text reply.
 */
export function sendMomentSticker(wa: StickerSender, jid: string, moment: string, opts: { force?: boolean } = {}): void {
  if (!opts.force && stickerOnCooldown(jid)) return;
  let sticker: Sticker | undefined;
  try {
    sticker = pickForMoment(moment);
  } catch (err) {
    console.error('[STICKER] Error looking up a sticker:', (err as Error).message);
    return;
  }
  if (!sticker) return;
  sendPackSticker(wa, jid, sticker).catch((err) => {
    console.error('[STICKER] Could not send "%s":', sticker!.label, (err as Error).message);
  });
}

/** The moment each successful tool action stands for. */
const ACTION_MOMENTS: Record<string, string> = {
  schedule_reminder: 'reminder_set',
  schedule_important_date: 'reminder_set',
  schedule_flexible_reminder: 'reminder_set',
  schedule_interval_reminder: 'reminder_set',
  schedule_free_slot_reminder: 'reminder_set',
  schedule_call_reminder: 'call_set',
  edit_call_reminder: 'call_set',
  edit_reminder: 'updated',
  edit_routine: 'updated',
  edit_todo: 'updated',
  send_message: 'message_sent',
  add_note: 'idea_saved',
  save_link: 'idea_saved',
  save_media: 'idea_saved',
  add_todo: 'list_updated',
  create_list: 'list_updated',
  add_list_item: 'list_updated',
  create_routine: 'routine_created',
  add_exercise: 'workout',
  plan_meal: 'food',
  save_recipe: 'food',
  suggest_recipes: 'food',
  add_contact: 'contact_saved',
  register_reward_punishment: 'reward',
  pause_notifications: 'rest',
  get_today_agenda: 'agenda',
  get_week_report: 'weekly_report',
  schedule_appointment: 'appointment',
  request_appointment: 'appointment',
  confirm_appointment: 'appointment',
};

/** A tool result that reads like a refusal or an error - no "done!" sticker for it. */
const FAILED_RESULT_RE =
  /^(error|no |me falta|esa hora|ese |esa |hay varias|varios |necesito|solo el administrador|ya se envi|¿)|no pude|no existe|no encontr|ya pas[oó]|no tienes permiso|tard[oó] demasiado/i;

/** Conversation moments detected in the person's own message. */
const TEXT_MOMENTS: { re: RegExp; moment: () => string }[] = [
  { re: /\b(buenas noches|a dormir|me voy a dormir)\b/i, moment: () => 'good_night' },
  { re: /\b(chao|chau|adi[oó]s|hasta luego|hasta ma[ñn]ana|nos vemos|bye)\b/i, moment: () => 'goodbye' },
  { re: /\b(gracias|te agradezco|mil gracias|eres (el|la) mejor)\b/i, moment: () => 'thanks' },
  { re: /\b(estoy (cansad|estresad|agotad|desmotivad|triste)|no puedo m[aá]s|que pereza|qu[eé] mamera)/i, moment: () => 'encouragement' },
  // the hour in the bot's time zone, not the server's
  { re: /^(hola|holi|buenas|buenos d[ií]as|buen d[ií]a|hey|qu[eé] m[aá]s|quiubo)\b/i, moment: () => (Number(nowLocal().slice(11, 13)) < 12 ? 'greeting_morning' : 'greeting') },
];

/**
 * After a reply went out: one sticker for what just happened - the last action that succeeded this
 * turn, or else the conversational moment of the person's message. A morning greeting with no
 * morning sticker falls back to a plain greeting one. Same cooldown as every other sticker.
 */
export function sendTurnSticker(wa: StickerSender, jid: string, turn: { userText: string; tools: { name: string; result: string }[] }): void {
  if (stickerOnCooldown(jid)) return;
  const done = turn.tools.filter((t) => ACTION_MOMENTS[t.name] && !FAILED_RESULT_RE.test(t.result.trim()));
  const moment = done.length ? ACTION_MOMENTS[done[done.length - 1].name] : TEXT_MOMENTS.find((m) => m.re.test(turn.userText.trim()))?.moment();
  if (!moment) return;
  const fallback = moment === 'greeting_morning' ? 'greeting' : null;
  if (fallback && !stickersModel.listUsable().some((s) => momentsOf(s).includes(moment))) sendMomentSticker(wa, jid, fallback);
  else sendMomentSticker(wa, jid, moment);
}

/**
 * The pack as the agent sees it in its system prompt: each label with what it's for (the admin's
 * own note, else the moments it fits). Capped so a big pack doesn't flood the prompt - stickers the
 * admin described come first.
 */
export function stickerPromptLines(limit = 40): string[] {
  const byLabel = new Map<string, string>();
  const described = [...stickersModel.listUsable()].sort((a, b) => Number(!!b.usage) - Number(!!a.usage));
  for (const s of described) {
    const label = s.label!;
    if (byLabel.has(label)) continue;
    const moments = momentsOf(s).map((k) => STICKER_MOMENTS.find((m) => m.key === k)?.label.toLowerCase()).filter(Boolean);
    const what = s.usage?.trim() || moments.join(', ');
    byLabel.set(label, what ? `${label} (${what})` : label);
    if (byLabel.size >= limit) break;
  }
  return [...byLabel.values()];
}
