import { fashionSessionsModel } from '../../../models/fashion-sessions.model.js';
import { garmentsModel } from '../../../models/garments.model.js';
import { outfitsModel } from '../../../models/outfits.model.js';
import { fashionProfileModel } from '../../../models/fashion-profile.model.js';
import { fashionMessageRefsModel } from '../../../models/fashion-message-refs.model.js';
import { usersModel } from '../../../models/users.model.js';
import { parseOutfitIntent } from '../outfit/intent.js';
import { recommendOutfit, replaceGarment, type RecommendationResult } from '../outfit/recommendation.service.js';
import { matchesMust, type OutfitContext } from '../outfit/candidate-filter.js';
import { readOutfitEdit, type OutfitEdit } from '../outfit/edit-commands.js';
import { GARMENT_TYPE_LABELS } from '../taxonomy.js';
import { refineContext } from '../outfit/request.js';
import { categoryEmoji, categoryLabel, colorFor, describeRequest, garmentLabel, humanize, isPluralGarment } from '../look.js';

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
import { spacesStorageService } from '../storage/spaces-storage.service.js';
import { footnote, keycap } from '../../../shared/utils/wa-format.js';
import { sleep } from '../../../shared/utils/human-delay.js';
import { todayLocal } from '../../../shared/utils/datetime.js';
import type { GarmentType } from '../taxonomy.js';
import type { Garment } from '../../../entities/index.js';
import type { FashionSessionData, OutfitDraft } from '../fashion.types.js';
import type { FashionRouterContext, FashionRouterResult } from '../fashion-router.types.js';
import type { WaManager } from '../../../channels/whatsapp/wa-manager.js';
import { HOME_MENU } from './home.flow.js';
import { sendMomentSticker } from '../../stickers/stickers.service.js';
import { readFollowUp, wardrobeQuery } from '../follow-up.js';

/**
 * Showing and editing an outfit. Every garment goes out as its own photo, so the person can act on
 * one piece by reacting to it - 👎 change just that one, ❤️ build another outfit around it, 🗑️ it's
 * no longer in the wardrobe, 👍 keep it fixed - and the summary comes last with the options for the
 * whole outfit (👍 save · 👎 another option). Everything can also be said in words ("cambia la
 * camiseta", "deja solo el pantalón", "ya no tengo esos zapatos"). Reactions are handled in
 * fashion-reactions.ts, which calls back into the functions exported here.
 */

const USER_GENDER_TO_GARMENT_GENDER: Record<string, string> = { male: 'hombre', female: 'mujer' };

const RESULT_OPTIONS = '1️⃣  💾 Guardar este outfit\n2️⃣  🔄 Dame otra opción\n3️⃣  ↩️ Volver\n4️⃣  👕 Me lo puse (no me lo sugieras esta semana)';
const PHOTO_HELP = footnote(
  '*Reacciona a una foto*',
  '👎 Cambiar solo esa  ·  ❤️ Armar otro con esa',
  '🗑️ Ya no la tengo  ·  👍 Dejarla fija',
  '*O a este mensaje:* 👍 Guardar  ·  👎 Otra opción',
);
const WORDS_HELP = '> También escribiendo: "cambia la camiseta", "deja solo el pantalón", "sin chaqueta", "más formal"';
const WORN_RE = /^(me lo puse|me la puse|lo use|lo usé|ya lo use|ya lo usé|usado|usada|marcar usad[oa]s?)\b/i;
const YES_RE = /^(1|s[ií]+|dale|claro|elim[ií]nala|elim[ií]nalo|borra(la|lo)?|ok)\b/i;
const NO_RE = /^(2|no+|nop|mejor no|d[eé]jala|d[eé]jalo|cancelar?)\b/i;

/**
 * Layers the person's stored styling profile on top of what THIS request said - never overriding
 * an explicit per-request color/style, only filling in what the request left unsaid, so "outfit
 * boda pero de negro" still means black even if the saved preference is another color. The gender
 * filter always comes from the profile (an identity fact, not a per-request wording).
 */
function withProfileDefaults(userId: number, context: OutfitContext): OutfitContext {
  const merged: OutfitContext = { ...context };
  if (!merged.colorsPreferred?.length) {
    const preferred = fashionProfileModel.preferredColors(userId);
    if (preferred.length) merged.colorsPreferred = preferred;
  }
  if (!merged.colorsAvoided?.length) {
    const avoided = fashionProfileModel.avoidedColors(userId);
    if (avoided.length) merged.colorsAvoided = avoided;
  }
  if (!merged.style) {
    const [firstPreferredStyle] = fashionProfileModel.preferredStyles(userId);
    if (firstPreferredStyle) merged.style = firstPreferredStyle;
  }
  const userGender = usersModel.getById(userId)?.gender;
  if (userGender) merged.genderFilter = USER_GENDER_TO_GARMENT_GENDER[userGender];
  return merged;
}

function draftFrom(context: OutfitContext, result: RecommendationResult): OutfitDraft {
  return { context, picks: result.picks, missingRoles: result.missingRoles, missingMust: result.missingMust, reason: result.reason };
}

/** "Armar outfit con esta prenda" (garment detail / wardrobe list): built around that exact garment. */
export async function enterOutfitWithGarment(ctx: FashionRouterContext, garmentId: number): Promise<FashionRouterResult> {
  await ctx.wa.sendText(ctx.jid, '🔎 Armando un outfit con esa prenda...').catch(() => {});
  const context = withProfileDefaults(ctx.userId, { requiredGarmentIds: [garmentId] });
  return presentOutfit(ctx.userId, ctx.jid, ctx.wa, draftFrom(context, await recommendOutfit(ctx.userId, context)));
}

/**
 * A free-form outfit request ("outfit para una boda", "algo fresco pero elegante para salir", "un
 * outfit con polo azul", "uno que no tenga camiseta blanca"). Read locally when possible (see
 * outfit/intent.ts), then the local-filter -> AI (only if needed) -> validate pipeline.
 */
export async function enterOutfitRequest(ctx: FashionRouterContext, rawText: string): Promise<FashionRouterResult> {
  await ctx.wa.sendText(ctx.jid, '🔎 Buscando el mejor outfit, dame un segundo...').catch(() => {});
  const context = withProfileDefaults(ctx.userId, await parseOutfitIntent(ctx.userId, rawText));
  const result = await recommendOutfit(ctx.userId, context);
  if (result.emptyWardrobe) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `Todavía no tienes prendas guardadas - agrega algunas primero con "agregar prenda".\n\n${HOME_MENU}` };
  }
  return presentOutfit(ctx.userId, ctx.jid, ctx.wa, draftFrom(context, result));
}

/**
 * Puts an outfit on screen: it becomes the session's current outfit and the answer sends one photo
 * per garment (all of them, or only `onlyPhotosOf` after a single swap) and then the summary.
 * Every message sent is remembered with the outfit, so a reaction to it works even later.
 */
export function presentOutfit(
  userId: number,
  jid: string,
  wa: WaManager,
  draft: OutfitDraft,
  opts: { headline?: string; onlyPhotosOf?: number[] } = {},
): FashionRouterResult {
  fashionSessionsModel.setState(userId, 'FASHION_OUTFIT_RESULT', { outfit: draft } satisfies FashionSessionData);
  const summary = renderSummary(userId, draft, opts.headline);
  if (draft.picks.length === 0) return { consumed: true, reply: summary };

  return {
    consumed: true,
    deliver: async () => {
      const garments = draft.picks.map((p) => garmentsModel.getById(userId, p.garmentId)).filter((g): g is Garment => !!g);
      const toShow = opts.onlyPhotosOf ? garments.filter((g) => opts.onlyPhotosOf!.includes(g.id)) : garments;
      // One at a time with a small gap: a burst of media in the same instant looks scripted.
      for (const garment of toShow) {
        const msgId = await wa.sendImage(jid, garment.image_url, garmentLabel({ ...garment, favorite: 0 })).catch(() => null);
        fashionMessageRefsModel.save(userId, msgId, 'garment', garment.id, draft);
        await sleep(350);
      }
      const summaryId = await wa.sendTextWithId(jid, summary);
      fashionMessageRefsModel.save(userId, summaryId, 'outfit', null, draft);
      return summary;
    },
  };
}

function renderSummary(userId: number, draft: OutfitDraft, headline?: string): string {
  const { context, picks, missingRoles, reason } = draft;
  const anchors = (context.requiredGarmentIds ?? [])
    .filter((id) => picks.some((p) => p.garmentId === id))
    .map((id) => garmentsModel.getById(userId, id))
    .filter((g): g is Garment => !!g);
  const asked = [
    anchors.length ? `con tu ${anchors.map((g) => garmentLabel({ ...g, favorite: 0 }).replace(/^\S+ /, '').toLowerCase()).join(' y tu ')}` : '',
    describeRequest(context),
  ]
    .filter(Boolean)
    .join(' · ');
  const all = garmentsModel.listAllActive(userId);
  const missingMust = (draft.missingMust ?? []).map((m) => {
    const label = `${categoryLabel(m.category).toLowerCase()}${m.color ? ` ${colorFor(m.category, m.color)}` : ''}`;
    return all.some((g) => g.category === m.category) ? `No tienes ${label}, usé la que más se acerca` : `No tienes ${label} en tu armario`;
  });

  const head = [...(headline ? [headline, ''] : []), '✨ *Tu outfit*', ...(asked ? [`🎯 ${asked}`] : [])];
  if (picks.length === 0) {
    return [...head, '', 'Con eso no me alcanzan las prendas de tu armario para armar una combinación.', ...missingMust.map((m) => `> ${m}`), '', '1️⃣  ↩️ Volver', '> O pídelo menos específico'].join('\n');
  }

  const lines = [...head, ''];
  for (const pick of picks) {
    const garment = all.find((g) => g.id === pick.garmentId);
    if (garment) lines.push(`${garmentLabel(garment)}${(context.requiredGarmentIds ?? []).includes(garment.id) ? ' 📌' : ''}`);
  }
  const MISSING: Partial<Record<GarmentType, string>> = {
    BOTTOM: 'No tienes pantalones, jeans ni faldas guardados: mándame una foto de cada uno ("agregar prenda") y los combino',
    TOP: 'No tienes camisas ni camisetas guardadas que sirvan para esto',
    FOOTWEAR: 'No tienes zapatos guardados que sirvan para esto',
  };
  const notes = [
    ...missingMust,
    ...missingRoles.map((role) => MISSING[role as GarmentType] ?? `No tienes ${GARMENT_TYPE_LABELS[role as GarmentType]?.toLowerCase() ?? role} que sirva para esto`),
  ];
  if (reason) lines.push('', `💬 ${reason}`);
  if (notes.length) lines.push('', ...notes.map((n) => `> ${n}`));
  lines.push('', PHOTO_HELP, '', RESULT_OPTIONS, WORDS_HELP);
  return lines.join('\n');
}

/** The current outfit, from the session - undefined when there's none on screen. */
export function currentOutfit(userId: number): OutfitDraft | undefined {
  return fashionSessionsModel.getData<FashionSessionData>(userId).outfit;
}

// ---------------------------------------------------------------------------------------------
// Whole-outfit actions
// ---------------------------------------------------------------------------------------------

export function saveOutfit(userId: number, draft: OutfitDraft, notify?: { wa: WaManager; jid: string }): string {
  // Re-validate every garment still belongs to this person right before writing: the draft only
  // lived in session data (JSON), never trusted blindly.
  const validPicks = draft.picks.filter((p) => garmentsModel.getById(userId, p.garmentId) !== undefined);
  if (validPicks.length === 0) return 'No hay nada que guardar.';
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const id = outfitsModel.create(
    userId,
    { occasion: str(draft.context.occasion), formality: str(draft.context.formality), season: str(draft.context.season), style: str(draft.context.style), aiReason: draft.reason || null },
    validPicks,
  );
  console.log('[FASHION] Outfit #%d saved for user #%d.', id, userId);
  if (notify) sendMomentSticker(notify.wa, notify.jid, 'outfit');
  return '✅ *Outfit guardado* · lo encuentras en "mis outfits"';
}

export function markWorn(userId: number, draft: OutfitDraft): string {
  const ids = draft.picks.map((p) => p.garmentId).filter((id) => garmentsModel.getById(userId, id) !== undefined);
  garmentsModel.setWorn(userId, ids, todayLocal());
  const s = ids.length === 1 ? '' : 's';
  return `👕 *Listo* · marqué ${ids.length} prenda${s} como usada${s} esta semana\n> No te las vuelvo a sugerir hasta el lunes, salvo que me las pidas`;
}

/** "Otra opción": the same request again - garments fixed with 👍 stay, the rest changes. */
export async function anotherOption(userId: number, jid: string, wa: WaManager, draft: OutfitDraft): Promise<FashionRouterResult> {
  const result = await recommendOutfit(userId, draft.context);
  if (result.emptyWardrobe || result.picks.length === 0) {
    return { consumed: true, reply: `No tengo otra combinación distinta con lo que tienes guardado.\n\n${RESULT_OPTIONS}` };
  }
  return presentOutfit(userId, jid, wa, draftFrom(draft.context, result));
}

// ---------------------------------------------------------------------------------------------
// Single-garment actions (reactions on a photo, or said in words)
// ---------------------------------------------------------------------------------------------

function nameOf(garment: Garment): string {
  return garmentLabel({ ...garment, favorite: 0 }).replace(/^\S+ /, '').toLowerCase();
}

/** "tu camiseta blanca" / "tus botas cafés". */
function yours(garment: Garment): string {
  return `${isPluralGarment(garment.category) ? 'tus' : 'tu'} ${nameOf(garment)}`;
}

/** 👎 / "cambia la camiseta": only that garment changes; everything else stays exactly as it was. */
export async function swapGarment(userId: number, jid: string, wa: WaManager, draft: OutfitDraft, garmentId: number): Promise<FashionRouterResult> {
  const garment = garmentsModel.getById(userId, garmentId);
  if (!garment) return { consumed: true, reply: 'Esa prenda ya no está en tu armario.' };
  // The person asked for it to change: it can't come back, and a "con polo azul" that named it no
  // longer forces it.
  const context: OutfitContext = {
    ...draft.context,
    excludeGarmentIds: [...new Set([...(draft.context.excludeGarmentIds ?? []), garmentId])],
    requiredGarmentIds: (draft.context.requiredGarmentIds ?? []).filter((id) => id !== garmentId),
    mustHave: (draft.context.mustHave ?? []).filter((m) => !matchesMust(garment, m)),
  };
  const replaced = replaceGarment(userId, context, draft.picks, garmentId);
  if (!replaced) {
    return { consumed: true, reply: `No tengo otra opción de ${categoryLabel(garment.category).toLowerCase()} que combine con el resto. Prueba ❤️ en otra prenda para armar uno nuevo alrededor de ella.` };
  }
  const newId = replaced.picks.find((p) => p.role === replaced.replacedRole && !draft.picks.some((d) => d.garmentId === p.garmentId))?.garmentId;
  const next: OutfitDraft = { ...draft, context, picks: replaced.picks, reason: '' };
  return presentOutfit(userId, jid, wa, next, { headline: `🔄 Cambié ${yours(garment)}; lo demás se queda igual`, onlyPhotosOf: newId ? [newId] : [] });
}

/** ❤️ / "deja solo el pantalón": a new outfit around that garment, with the other pieces changed. */
export async function keepOnlyGarment(userId: number, jid: string, wa: WaManager, draft: OutfitDraft, garmentId: number): Promise<FashionRouterResult> {
  const garment = garmentsModel.getById(userId, garmentId);
  if (!garment) return { consumed: true, reply: 'Esa prenda ya no está en tu armario.' };
  const others = draft.picks.map((p) => p.garmentId).filter((id) => id !== garmentId);
  // Only that garment is kept: garments the request named ("con polo azul") and earlier swaps no
  // longer apply - the other pieces of THIS outfit are the ones to change.
  const base: OutfitContext = { ...draft.context, mustHave: (draft.context.mustHave ?? []).filter((m) => matchesMust(garment, m)), requiredGarmentIds: [garmentId] };
  delete base.excludeGarmentIds;
  const context: OutfitContext = { ...base, excludeGarmentIds: others };
  await wa.sendText(jid, `📌 Armando otro outfit con ${yours(garment)}...`).catch(() => {});
  let result = await recommendOutfit(userId, context);
  // With a small wardrobe, changing every other piece may leave a role empty: then a piece of the
  // previous outfit may come back rather than having no trousers at all.
  if (result.missingRoles.length) result = await recommendOutfit(userId, base);
  return presentOutfit(userId, jid, wa, draftFrom(result.missingRoles.length ? context : base, result));
}

/** 👍 on a photo: that garment stays in every "otra opción" from now on. */
export function pinGarment(userId: number, draft: OutfitDraft, garmentId: number): FashionRouterResult {
  const garment = garmentsModel.getById(userId, garmentId);
  if (!garment) return { consumed: true, reply: 'Esa prenda ya no está en tu armario.' };
  const next: OutfitDraft = {
    ...draft,
    context: { ...draft.context, requiredGarmentIds: [...new Set([...(draft.context.requiredGarmentIds ?? []), garmentId])] },
  };
  fashionSessionsModel.setState(userId, 'FASHION_OUTFIT_RESULT', { outfit: next } satisfies FashionSessionData);
  return { consumed: true, reply: `📌 ${cap(yours(garment))} ${isPluralGarment(garment.category) ? 'quedan fijos' : 'queda fija'}: si pides otra opción, se mantiene${isPluralGarment(garment.category) ? 'n' : ''}.` };
}

/** 🗑️ / "ya no tengo esos zapatos": asks before deleting - it can't be undone. */
export function askDeleteGarment(userId: number, jid: string, wa: WaManager, draft: OutfitDraft, garmentId: number): FashionRouterResult {
  const garment = garmentsModel.getById(userId, garmentId);
  if (!garment) return { consumed: true, reply: 'Esa prenda ya no está en tu armario.' };
  fashionSessionsModel.setState(userId, 'FASHION_OUTFIT_RESULT', { outfit: draft, pendingDeleteId: garmentId } satisfies FashionSessionData);
  const question = `🗑️ ¿Elimino ${yours(garment)} de tu armario? No se puede deshacer.\n\n${footnote('Reacciona a este mensaje', '👍 Sí, eliminar  ·  👎 No')}`;
  return {
    consumed: true,
    deliver: async () => {
      const msgId = await wa.sendTextWithId(jid, question);
      fashionMessageRefsModel.save(userId, msgId, 'delete_confirm', garmentId, draft);
      return question;
    },
  };
}

/** The answer to "¿la elimino?": on yes it's deleted and, if it was in the outfit, replaced there. */
export async function answerDeleteGarment(
  userId: number,
  jid: string,
  wa: WaManager,
  draft: OutfitDraft,
  garmentId: number,
  confirmed: boolean,
): Promise<FashionRouterResult> {
  fashionSessionsModel.setState(userId, 'FASHION_OUTFIT_RESULT', { outfit: draft } satisfies FashionSessionData);
  const garment = garmentsModel.getById(userId, garmentId);
  if (!garment) return { consumed: true, reply: 'Esa prenda ya no está en tu armario.' };
  if (!confirmed) return { consumed: true, reply: `👌 Listo, ${yours(garment)} ${isPluralGarment(garment.category) ? 'se quedan' : 'se queda'} en el armario.` };

  // Picked the replacement first, while the garment still exists to compare against.
  const inOutfit = draft.picks.some((p) => p.garmentId === garmentId);
  const swap = inOutfit ? await swapGarment(userId, jid, wa, draft, garmentId) : null;
  const removed = garmentsModel.remove(userId, garmentId);
  if (removed) await spacesStorageService.delete([removed.storageKey, removed.thumbnailKey].filter((k): k is string => !!k));
  console.log('[FASHION] Garment #%d deleted from an outfit for user #%d.', garmentId, userId);
  const done = `🗑️ Eliminé ${yours(garment)} de tu armario.`;
  if (!swap || swap.reply) {
    const remaining: OutfitDraft = { ...draft, picks: draft.picks.filter((p) => p.garmentId !== garmentId) };
    fashionSessionsModel.setState(userId, 'FASHION_OUTFIT_RESULT', { outfit: remaining } satisfies FashionSessionData);
    return { consumed: true, reply: swap?.reply ? `${done}\n\n${swap.reply}` : done };
  }
  return {
    consumed: true,
    deliver: async () => {
      await wa.sendText(jid, done);
      return swap.deliver!();
    },
  };
}

async function applyEdit(ctx: FashionRouterContext, draft: OutfitDraft, edit: OutfitEdit): Promise<FashionRouterResult> {
  if (edit.kind === 'swap') return swapGarment(ctx.userId, ctx.jid, ctx.wa, draft, edit.garmentId);
  if (edit.kind === 'keep_only') return keepOnlyGarment(ctx.userId, ctx.jid, ctx.wa, draft, edit.garmentId);
  return askDeleteGarment(ctx.userId, ctx.jid, ctx.wa, draft, edit.garmentId);
}

// ---------------------------------------------------------------------------------------------
// Text answers while an outfit is on screen
// ---------------------------------------------------------------------------------------------

export async function handleOutfitResult(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsModel.getData<FashionSessionData>(ctx.userId);
  const outfit = data.outfit;
  const text = ctx.text.trim();

  if (!outfit) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  if (data.pendingDeleteId !== undefined) {
    if (YES_RE.test(text)) return answerDeleteGarment(ctx.userId, ctx.jid, ctx.wa, outfit, data.pendingDeleteId, true);
    if (NO_RE.test(text)) return answerDeleteGarment(ctx.userId, ctx.jid, ctx.wa, outfit, data.pendingDeleteId, false);
    fashionSessionsModel.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', { outfit } satisfies FashionSessionData);
    // anything else is a new message of its own, read below
  }

  // The answer to "¿es para cambiar el outfit o es otra cosa?" - asked about the message held in pendingFollowUp.
  if (data.pendingFollowUp) {
    const held = data.pendingFollowUp;
    fashionSessionsModel.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', { outfit } satisfies FashionSessionData);
    // only a bare answer to that question - "cambia los zapatos" is a new instruction of its own
    if (text === '1' || /^(cambiar|cambia|ajustar|ajusta|cambiar el outfit|cambia el outfit|el outfit|s[ií])[.!]?$/i.test(text)) return refineOutfit(ctx, outfit, held);
    if (text === '2' || /^(otra cosa|es otra cosa|no|salir|nada)[.!]?$/i.test(text)) {
      fashionSessionsModel.clear(ctx.userId);
      return { consumed: false, forward: held };
    }
  }

  if (text === '3' || /^volver/i.test(text)) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }
  if (text === '4' || WORN_RE.test(text)) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `${markWorn(ctx.userId, outfit)}\n\n${HOME_MENU}` };
  }
  if (text === '1' || /^guardar/i.test(text)) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `${saveOutfit(ctx.userId, outfit, { wa: ctx.wa, jid: ctx.jid })}\n\n${HOME_MENU}` };
  }

  // One piece named in words: "cambia la camiseta", "deja solo el pantalón", "ya no tengo esos zapatos".
  const edit = readOutfitEdit(text, outfit.picks, garmentsModel.listAllActive(ctx.userId));
  if (edit) return applyEdit(ctx, outfit, edit);

  if (text === '2' || /^otra( opci[oó]n)?\b/i.test(text)) return anotherOption(ctx.userId, ctx.jid, ctx.wa, outfit);

  // Going somewhere else in Fashion Mode isn't an adjustment to this outfit.
  if (/^(armario|mis prendas|mis outfits|agregar|guardar ropa|menu|menú|inicio|fashion|moda)\b/i.test(text)) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    const { handleHome } = await import('./home.flow.js');
    return handleHome(ctx);
  }

  // Only what clearly reads as an adjustment is taken as one (see follow-up.ts). The rest goes
  // where it belongs, and what can't be told apart is asked - never answered with one more outfit.
  const kind = readFollowUp(text);
  if (kind === 'other') {
    fashionSessionsModel.clear(ctx.userId);
    return { consumed: false };
  }
  if (kind === 'wardrobe') {
    const { enterWardrobeList, parseFilterText } = await import('./list-garments.flow.js');
    return { consumed: true, reply: enterWardrobeList(ctx.userId, parseFilterText(wardrobeQuery(text))) };
  }
  if (kind === 'new_outfit') return enterOutfitRequest(ctx, text);
  if (kind === 'unsure') {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', { outfit, pendingFollowUp: text } satisfies FashionSessionData);
    return { consumed: true, reply: FOLLOW_UP_QUESTION };
  }
  return refineOutfit(ctx, outfit, text);
}

const FOLLOW_UP_QUESTION =
  '🤔 No sé si eso es para cambiar el outfit o es otra cosa.\n\n1️⃣  👕 Cambiar este outfit\n2️⃣  💬 Es otra cosa\n> Con *2* salgo de outfits y te respondo eso normal';

/** Merges an adjustment ("sin chaqueta", "más formal", "que no sea blanco arriba") onto the outfit's request and recommends again. */
async function refineOutfit(ctx: FashionRouterContext, outfit: OutfitDraft, text: string): Promise<FashionRouterResult> {
  const change = await parseOutfitIntent(ctx.userId, text);
  if (Object.values(change).every((v) => v === undefined || (Array.isArray(v) && v.length === 0))) {
    return { consumed: true, reply: `No entendí ese ajuste.\n\n${RESULT_OPTIONS}\n${WORDS_HELP}` };
  }
  const refined = withProfileDefaults(ctx.userId, refineContext(outfit.context, change));
  return presentOutfit(ctx.userId, ctx.jid, ctx.wa, draftFrom(refined, await recommendOutfit(ctx.userId, refined)));
}

// ---------------------------------------------------------------------------------------------
// Saved outfits ("mis outfits")
// ---------------------------------------------------------------------------------------------

function outfitTitle(o: { id: number; occasion: string | null; name: string | null; favorite: number }): string {
  const label = o.name ?? (o.occasion ? `Para ${humanize(o.occasion)}` : 'Outfit guardado');
  return `${label}${o.favorite ? ' ❤️' : ''}`;
}

export function enterMyOutfits(userId: number): string {
  const { rows, total } = outfitsModel.list(userId, { limit: 10, offset: 0 });
  fashionSessionsModel.setState(userId, 'FASHION_MY_OUTFITS_LIST', { lastListedOutfitIds: rows.map((o) => o.id) } satisfies FashionSessionData);

  if (total === 0) return '❤️ *Tus outfits guardados*\nTodavía no has guardado ninguno.\n\n1️⃣  ↩️ Volver\n\n> Crea uno con "outfit para la oficina" y guárdalo';

  const lines = [`❤️ *Tus outfits guardados* · ${total}`, ''];
  rows.forEach((o, i) => {
    lines.push(`${keycap(i + 1)}  *${outfitTitle(o)}*`);
    lines.push(`> ${o.garments.map((link) => categoryEmoji(link.garment.category, link.role)).join(' ')}  ${o.garments.length} prenda${o.garments.length === 1 ? '' : 's'}`);
  });
  lines.push('', '> Escribe el número para verlo con sus fotos · *volver*');
  return lines.join('\n');
}

export async function handleMyOutfitsList(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsModel.getData<FashionSessionData>(ctx.userId);
  const text = ctx.text.trim().toLowerCase();

  const ids = data.lastListedOutfitIds ?? [];
  // "1" is "Volver" only on the empty screen - with outfits listed it's the first one.
  if (text === 'volver' || (text === '1' && ids.length === 0)) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  const choice = Number(text);
  if (Number.isInteger(choice) && choice >= 1 && choice <= ids.length) {
    const saved = outfitsModel.getById(ctx.userId, ids[choice - 1]);
    if (!saved) return { consumed: true, reply: 'No encontré ese outfit.' };
    // Shown like any other outfit: the same reactions and edits work on it.
    const draft: OutfitDraft = {
      context: { ...(saved.occasion ? { occasion: saved.occasion } : {}), ...(saved.formality ? { formality: saved.formality } : {}) },
      picks: saved.garments.map((link) => ({ garmentId: link.garment.id, role: link.role as GarmentType })),
      missingRoles: [],
      reason: saved.ai_reason ?? '',
    };
    return presentOutfit(ctx.userId, ctx.jid, ctx.wa, draft, { headline: `❤️ *${outfitTitle(saved)}*` });
  }

  if (/^(mis outfits|outfits)$/.test(text)) return { consumed: true, reply: enterMyOutfits(ctx.userId) };
  // Anything else isn't a choice from this list: back to Fashion's home, which either takes it as
  // an outfit request or steps aside for a normal message.
  fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
  const { handleHome } = await import('./home.flow.js');
  return handleHome(ctx);
}
