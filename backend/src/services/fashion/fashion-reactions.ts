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
 * A quoted reply to one of them ("cambiar", "fija", "ya no la tengo", "guardar") is read as the
 * matching reaction - see handleFashionQuotedReply.
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

// What a quoted reply says, as the reaction it stands for. Short answers only: a longer sentence
// quoting the photo is a normal message ("cambia la camiseta por una polo" goes through the flow).
const REPLY_AS_EMOJI: Array<[RegExp, string]> = [
  [/^(🗑️?|ya no (la|lo|las|los) tengo|ya no (la|lo|las|los) uso|elimin(ar|a|ala|alo|alas|alos)|borr(ar|a|ala|alo|alas|alos)|quitar del armario)$/, '🗑'],
  [/^(❤️?|armar otro( outfit)?( con (esta|este|estas|estos|ella|ellos))?|arma otro( outfit)?( con (esta|este|estas|estos|ella|ellos))?|con (esta|este|estas|estos)|otro con (esta|este|estas|estos)|me encanta)$/, '❤'],
  [/^(👎|cambiar|cambia|c[aá]mbia(la|lo|las|los)|cambiar (esta|este|estas|estos)|otra|otro|otra opci[oó]n|no me gusta|esa no|ese no|no)$/, '👎'],
  [/^(👍|fija|fijo|fijas|fijos|d[eé]ja(la|lo|las|los)( fij[oa]s?)?|dejar fij[oa]s?|me gusta|s[ií]|ok|dale|guardar|guarda(lo)?)$/, '👍'],
  [/^(👕|me lo puse|me la puse|lo us[eé]|usado|usada)$/, '👕'],
];

/** A text reply that quotes one of Fashion Mode's messages: handled like the reaction it means, or null. */
export async function handleFashionQuotedReply(input: { userId: number; jid: string; quotedId: string; text: string; wa: WaManager }): Promise<FashionRouterResult | null> {
  const said = input.text.trim().toLowerCase().replace(/[.!¡¿?]+/g, '').replace(/\s+/g, ' ');
  const match = REPLY_AS_EMOJI.find(([re]) => re.test(said));
  if (!match) return null;
  return handleFashionReaction({ userId: input.userId, jid: input.jid, targetId: input.quotedId, emoji: match[1], wa: input.wa });
}
