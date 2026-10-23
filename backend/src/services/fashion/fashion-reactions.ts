import { fashionMessageRefsModel } from '../../models/fashion-message-refs.model.js';
import { fashionSessionsModel } from '../../models/fashion-sessions.model.js';
import {
  anotherOption,
  answerDeleteGarment,
  askDeleteGarment,
  currentOutfit,
  keepOnlyGarment,
  markWorn,
  pinGarment,
  saveOutfit,
  swapGarment,
} from './flows/outfit.flow.js';
import type { WaManager } from '../../channels/whatsapp/wa-manager.js';
import type { FashionRouterResult } from './fashion-router.types.js';
import type { FashionSessionData, OutfitDraft } from './fashion.types.js';

/**
 * Reactions on Fashion Mode's own messages (see flows/outfit.flow.ts):
 *   on a garment photo   👎 change only that one · ❤️ build another outfit around it
 *                        🗑️ it's no longer in the wardrobe (asks first) · 👍 keep it fixed
 *   on the summary       👍 save the outfit · 👎 another option · 👕 I wore it
 *   on "¿la elimino?"    👍 yes · 👎 no
 * The message is looked up in fashion_message_refs, so a reaction works even after the chat moved
 * on. Returns null when the reaction isn't on one of these messages, or means nothing here.
 */
type Action = 'swap' | 'keep_only' | 'delete' | 'pin' | 'yes' | 'no' | 'worn';

// Skin-tone modifiers and the variation selector ride along with the base emoji.
const base = (emoji: string) => emoji.replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu, '');
const SWAP = new Set(['👎', '🔄', '🔁', '❌', '🙅', '😒', '🤢', '🥱']);
const KEEP_ONLY = new Set(['❤', '😍', '🥰', '💖', '💕', '💗', '💘', '💓', '🤩', '😻', '♥']);
const DELETE = new Set(['🗑', '🚮']);
const PIN = new Set(['👍', '👌', '✅', '📌', '💪', '🔥', '💯', '🙌', '👏']);
const WORN = new Set(['👕', '👔', '👚', '👗']);

function photoAction(emoji: string): Action | null {
  const e = base(emoji);
  if (SWAP.has(e)) return 'swap';
  if (KEEP_ONLY.has(e)) return 'keep_only';
  if (DELETE.has(e)) return 'delete';
  if (PIN.has(e)) return 'pin';
  return null;
}

function summaryAction(emoji: string): Action | null {
  const e = base(emoji);
  if (WORN.has(e)) return 'worn';
  if (PIN.has(e) || KEEP_ONLY.has(e)) return 'yes';
  if (SWAP.has(e)) return 'no';
  return null;
}

/** The outfit the reacted message belongs to: the one on screen when it's the same, else the one remembered with the message. */
function outfitFor(userId: number, remembered: OutfitDraft, garmentId: number | null): OutfitDraft {
  const current = currentOutfit(userId);
  if (current && (garmentId === null ? sameOutfit(current, remembered) : current.picks.some((p) => p.garmentId === garmentId))) return current;
  return remembered;
}

function sameOutfit(a: OutfitDraft, b: OutfitDraft): boolean {
  const ids = (d: OutfitDraft) => d.picks.map((p) => p.garmentId).sort((x, y) => x - y).join(',');
  return ids(a) === ids(b);
}

export async function handleFashionReaction(input: { userId: number; jid: string; targetId: string; emoji: string; wa: WaManager }): Promise<FashionRouterResult | null> {
  const { userId, jid, targetId, emoji, wa } = input;
  const ref = fashionMessageRefsModel.find<OutfitDraft>(userId, targetId);
  if (!ref) return null;
  const remembered = ref.payload;
  if (!remembered?.picks) return null;

  if (ref.kind === 'delete_confirm' && ref.garment_id !== null) {
    const answer = summaryAction(emoji);
    if (answer !== 'yes' && answer !== 'no') return null;
    return answerDeleteGarment(userId, jid, wa, outfitFor(userId, remembered, null), ref.garment_id, answer === 'yes');
  }

  if (ref.kind === 'garment' && ref.garment_id !== null) {
    const action = photoAction(emoji);
    if (!action) return null;
    const draft = outfitFor(userId, remembered, ref.garment_id);
    // An old photo of a garment that is no longer in the outfit can still start a new one around it.
    const inOutfit = draft.picks.some((p) => p.garmentId === ref.garment_id);
    if (action === 'keep_only') return keepOnlyGarment(userId, jid, wa, draft, ref.garment_id);
    if (action === 'delete') return askDeleteGarment(userId, jid, wa, draft, ref.garment_id);
    if (!inOutfit) return { consumed: true, reply: 'Esa foto es de un outfit anterior. Reacciona ❤️ si quieres que arme uno nuevo con esa prenda.' };
    if (action === 'swap') return swapGarment(userId, jid, wa, draft, ref.garment_id);
    return pinGarment(userId, draft, ref.garment_id);
  }

  if (ref.kind === 'outfit') {
    const action = summaryAction(emoji);
    if (!action) return null;
    const draft = outfitFor(userId, remembered, null);
    if (action === 'no') return anotherOption(userId, jid, wa, draft);
    fashionSessionsModel.setState(userId, 'FASHION_HOME', {} satisfies FashionSessionData);
    return { consumed: true, reply: action === 'worn' ? markWorn(userId, draft) : saveOutfit(userId, draft, { wa, jid }) };
  }
  return null;
}
