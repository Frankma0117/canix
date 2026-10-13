import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { outfitsRepo } from '../../db/repositories/outfits.repo.js';
import { fashionProfileRepo } from '../../db/repositories/fashion-profile.repo.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { parseOutfitIntent } from '../outfit/intent.js';
import { recommendOutfit } from '../outfit/recommendation.service.js';
import type { OutfitContext } from '../outfit/candidate-filter.js';
import { GARMENT_TYPE_LABELS } from '../taxonomy.js';
import { refineContext } from '../outfit/request.js';
import { categoryEmoji, categoryLabel, colorFor, describeRequest, garmentLabel, humanize } from '../look.js';
import { keycap } from '../../util/wa-format.js';
import type { GarmentType } from '../taxonomy.js';
import type { FashionSessionData } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';
import { sleep } from '../../util/human-delay.js';
import { readFollowUp, wardrobeQuery } from '../follow-up.js';

const USER_GENDER_TO_GARMENT_GENDER: Record<string, string> = { male: 'hombre', female: 'mujer' };

/**
 * Layers the user's stored styling profile on top of what THIS request itself said - never
 * overrides an explicit per-request color/style, only fills in what the request left unsaid, so
 * "outfit boda pero de negro" still means negro even if the saved preference is otro color.
 * genderFilter always comes from the profile (an identity fact, not a per-request wording) - see
 * candidate-filter.ts's OutfitContext comment.
 */
function withProfileDefaults(userId: number, context: OutfitContext): OutfitContext {
  const merged: OutfitContext = { ...context };

  if (!merged.colorsPreferred?.length) {
    const preferred = fashionProfileRepo.preferredColors(userId);
    if (preferred.length) merged.colorsPreferred = preferred;
  }
  if (!merged.colorsAvoided?.length) {
    const avoided = fashionProfileRepo.avoidedColors(userId);
    if (avoided.length) merged.colorsAvoided = avoided;
  }
  if (!merged.style) {
    const [firstPreferredStyle] = fashionProfileRepo.preferredStyles(userId);
    if (firstPreferredStyle) merged.style = firstPreferredStyle;
  }

  const userGender = usersRepo.getById(userId)?.gender;
  if (userGender) merged.genderFilter = USER_GENDER_TO_GARMENT_GENDER[userGender];

  return merged;
}

const RESULT_OPTIONS = '1️⃣  💾 Guardar este outfit\n2️⃣  🔄 Dame otra opción\n3️⃣  ↩️ Volver';
const REFINE_HINT = '> Ajústalo escribiendo: "sin chaqueta", "con tenis", "más formal", "nada de negro"';

/**
 * Entry point for a free-form outfit request ("outfit para una boda", "algo fresco pero elegante
 * para salir con mi novia") - typed either as a "fashion outfit X" shortcut on entry (see
 * router.ts) or as unrecognized free text from FASHION_HOME (see home.flow.ts). Runs the full
 * local-filter -> AI (only if needed) -> validate pipeline (see outfit/recommendation.service.ts) -
 * this is the one place in Fashion Mode that can spend DeepSeek tokens, and only when the request
 * doesn't resolve to a plain local match already (see outfit/intent.ts).
 */
export async function enterOutfitRequest(ctx: FashionRouterContext, rawText: string): Promise<string> {
  await ctx.wa.sendText(ctx.jid, '🔎 Buscando el mejor outfit, dame un segundo...').catch(() => {});

  const context = withProfileDefaults(ctx.userId, await parseOutfitIntent(ctx.userId, rawText));
  const result = await recommendOutfit(ctx.userId, context);

  if (result.emptyWardrobe) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return `Todavía no tienes prendas guardadas - agrega algunas primero con "agregar prenda".\n\n${HOME_MENU}`;
  }

  return renderResult(ctx, context, result);
}

async function renderResult(
  ctx: FashionRouterContext,
  context: OutfitContext,
  result: { picks: { garmentId: number; role: GarmentType }[]; missingRoles: GarmentType[]; missingMust?: { category: string; color?: string }[]; reason: string },
): Promise<string> {
  const { picks, missingRoles, reason } = result;
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', {
    outfit: { context: context as Record<string, unknown>, picks, missingRoles, reason },
  } satisfies FashionSessionData);

  const asked = describeRequest(context);
  const missingMust = (result.missingMust ?? []).map((m) => {
    const label = `${categoryLabel(m.category).toLowerCase()}${m.color ? ` ${colorFor(m.category, m.color)}` : ''}`;
    const owned = garmentsRepo.listAllActive(ctx.userId).some((g) => g.category === m.category);
    return owned ? `No tienes ${label}, usé la que más se acerca` : `No tienes ${label} en tu armario`;
  });

  if (picks.length === 0) {
    return [
      '✨ *Tu outfit*',
      ...(asked ? [`🎯 ${asked}`] : []),
      '',
      'Con eso no me alcanzan las prendas de tu armario para armar una combinación.',
      ...missingMust.map((m) => `> ${m}`),
      '',
      '1️⃣  ↩️ Volver',
      '> O pídelo menos específico',
    ].join('\n');
  }

  const lines = ['✨ *Tu outfit*', ...(asked ? [`🎯 ${asked}`] : []), ''];
  const imagesToSend: { url: string; caption: string }[] = [];

  for (const pick of picks) {
    const garment = garmentsRepo.getById(ctx.userId, pick.garmentId);
    if (!garment) continue;
    lines.push(garmentLabel(garment));
    // The full-resolution original, not the small wardrobe-listing thumbnail - this is the "here's
    // what I picked for you" moment, where a handful of photos going out at once matters more than
    // it does for scrolling through a whole wardrobe list (see list-garments.flow.ts, which still
    // uses the thumbnail on purpose for that different case).
    imagesToSend.push({ url: garment.image_url, caption: garmentLabel({ ...garment, favorite: 0 }) });
  }

  const MISSING: Partial<Record<GarmentType, string>> = {
    BOTTOM: 'No tienes pantalones, jeans ni faldas guardados: mándame una foto de cada uno ("agregar prenda") y los combino',
    TOP: 'No tienes camisas ni camisetas guardadas que sirvan para esto',
    FOOTWEAR: 'No tienes zapatos guardados que sirvan para esto',
  };
  const notes = [...missingMust, ...missingRoles.map((role) => MISSING[role] ?? `No tienes ${GARMENT_TYPE_LABELS[role].toLowerCase()} que sirva para esto`)];
  if (reason) lines.push('', `💬 ${reason}`);
  if (notes.length) lines.push('', ...notes.map((n) => `> ${n}`));
  lines.push('', RESULT_OPTIONS, REFINE_HINT);

  // Best-effort, never blocks the text summary above (which already went out via the returned
  // reply) - a few photos, not the whole wardrobe, matching the "no enviar todo de golpe" spirit.
  // Sent one at a time with a small gap rather than all at once (Promise.all) - a burst of several
  // media messages fired in the same instant is one more "obviously scripted" pattern worth
  // avoiding, same reasoning as the reminder/broadcast pacing (see task-scheduler.ts,
  // announce-update.tool.ts).
  void (async () => {
    for (const img of imagesToSend.slice(0, 5)) {
      await ctx.wa.sendImage(ctx.jid, img.url, img.caption).catch(() => {});
      await sleep(300);
    }
  })();

  return lines.join('\n');
}

export async function handleOutfitResult(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const outfit = data.outfit;
  const text = ctx.text.trim();

  if (!outfit) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  // The answer to "¿es para cambiar el outfit o es otra cosa?" - asked about the message held in pendingFollowUp.
  if (data.pendingFollowUp) {
    const held = data.pendingFollowUp;
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', { outfit } satisfies FashionSessionData);
    if (text === '1' || /^(cambiar|cambia|ajustar|ajusta|el outfit|s[ií])\b/i.test(text)) return refineOutfit(ctx, outfit, held);
    if (text === '2' || /^(otra cosa|es otra cosa|no|salir|nada)\b/i.test(text)) {
      fashionSessionsRepo.clear(ctx.userId);
      return { consumed: false, forward: held };
    }
    // anything else is a new message of its own, read below like any other
  }

  if (text === '3' || /^volver/i.test(text)) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  if (text === '1' || /^guardar/i.test(text)) {
    if (outfit.picks.length === 0) {
      fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
      return { consumed: true, reply: `No hay nada que guardar.\n\n${HOME_MENU}` };
    }
    // Re-validate every garment id still belongs to this user right before persisting - the draft
    // only ever lived in session data (JSON), never trust it blindly at the moment of writing.
    const validPicks = outfit.picks.filter((p) => garmentsRepo.getById(ctx.userId, p.garmentId) !== undefined);
    const id = outfitsRepo.create(
      ctx.userId,
      {
        occasion: typeof outfit.context.occasion === 'string' ? outfit.context.occasion : null,
        formality: typeof outfit.context.formality === 'string' ? outfit.context.formality : null,
        season: typeof outfit.context.season === 'string' ? outfit.context.season : null,
        style: typeof outfit.context.style === 'string' ? outfit.context.style : null,
        aiReason: outfit.reason || null,
      },
      validPicks,
    );
    console.log('[FASHION] Outfit #%d guardado para el usuario #%d.', id, ctx.userId);
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: `✅ *Outfit guardado* · lo encuentras en "mis outfits"\n\n${HOME_MENU}` };
  }

  if (text === '2' || /^otra/i.test(text)) {
    const { recommendOutfit } = await import('../outfit/recommendation.service.js');
    const result = await recommendOutfit(ctx.userId, outfit.context, { forceNew: true });
    if (result.emptyWardrobe || result.picks.length === 0) {
      return { consumed: true, reply: `No tengo otra combinación distinta con lo que tienes guardado.\n\n${RESULT_OPTIONS}\n${REFINE_HINT}` };
    }
    const reply = await renderResult(ctx, outfit.context as OutfitContext, result);
    return { consumed: true, reply };
  }

  // Going somewhere else in Fashion Mode isn't an adjustment to this outfit.
  if (/^(armario|mis prendas|mis outfits|agregar|guardar ropa|menu|menú|inicio|fashion|moda)\b/i.test(text)) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    const { handleHome } = await import('./home.flow.js');
    return handleHome(ctx);
  }

  // Only what clearly reads as an adjustment is taken as one (see follow-up.ts). The rest goes
  // where it belongs, and what can't be told apart is asked - never answered with one more outfit.
  const kind = readFollowUp(text);
  if (kind === 'other') {
    fashionSessionsRepo.clear(ctx.userId);
    return { consumed: false };
  }
  if (kind === 'wardrobe') {
    const { enterWardrobeList, parseFilterText } = await import('./list-garments.flow.js');
    return { consumed: true, reply: enterWardrobeList(ctx.userId, parseFilterText(wardrobeQuery(text))) };
  }
  if (kind === 'new_outfit') return { consumed: true, reply: await enterOutfitRequest(ctx, text) };
  if (kind === 'unsure') {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', { outfit, pendingFollowUp: text } satisfies FashionSessionData);
    return { consumed: true, reply: FOLLOW_UP_QUESTION };
  }
  return refineOutfit(ctx, outfit, text);
}

const FOLLOW_UP_QUESTION =
  '🤔 No sé si eso es para cambiar el outfit o es otra cosa.\n\n1️⃣  👕 Cambiar este outfit\n2️⃣  💬 Es otra cosa\n> Con *2* salgo de outfits y te respondo eso normal';

/** Merges an adjustment ("sin chaqueta", "más formal") onto the outfit's request and recommends again. */
async function refineOutfit(ctx: FashionRouterContext, outfit: NonNullable<FashionSessionData['outfit']>, text: string): Promise<FashionRouterResult> {
  const change = await parseOutfitIntent(ctx.userId, text);
  if (Object.values(change).every((v) => v === undefined || (Array.isArray(v) && v.length === 0))) {
    return { consumed: true, reply: `No entendí ese ajuste.\n\n${RESULT_OPTIONS}\n${REFINE_HINT}` };
  }
  const refined = withProfileDefaults(ctx.userId, refineContext(outfit.context as OutfitContext, change));
  const refinedResult = await recommendOutfit(ctx.userId, refined, { forceNew: true });
  return { consumed: true, reply: await renderResult(ctx, refined, refinedResult) };
}

function outfitTitle(o: { id: number; occasion: string | null; name: string | null; favorite: number }): string {
  const label = o.name ?? (o.occasion ? `Para ${humanize(o.occasion)}` : `Outfit #${o.id}`);
  return `${label}${o.favorite ? ' ❤️' : ''}`;
}

export function enterMyOutfits(userId: number): string {
  const { rows, total } = outfitsRepo.list(userId, { limit: 10, offset: 0 });
  fashionSessionsRepo.setState(userId, 'FASHION_MY_OUTFITS_LIST', {
    lastListedOutfitIds: rows.map((o) => o.id),
  } satisfies FashionSessionData);

  if (total === 0) return '❤️ *Tus outfits guardados*\nTodavía no has guardado ninguno.\n\n1️⃣  ↩️ Volver\n\n> Crea uno con "outfit para la oficina" y guárdalo';

  const lines = [`❤️ *Tus outfits guardados* · ${total}`, ''];
  rows.forEach((o, i) => {
    lines.push(`${keycap(i + 1)}  *${outfitTitle(o)}*`);
    lines.push(`> ${o.garments.map((link) => categoryEmoji(link.garment.category, link.role)).join(' ')}  ${o.garments.length} prenda${o.garments.length === 1 ? '' : 's'}`);
  });
  lines.push('', '> Escribe el número para ver uno · *volver*');
  return lines.join('\n');
}

export async function handleMyOutfitsList(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const text = ctx.text.trim().toLowerCase();

  const ids = data.lastListedOutfitIds ?? [];
  // "1" is "Volver" only on the empty screen - with outfits listed it's the first one.
  if (text === 'volver' || (text === '1' && ids.length === 0)) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  const choice = Number(text);
  if (Number.isInteger(choice) && choice >= 1 && choice <= ids.length) {
    const outfit = outfitsRepo.getById(ctx.userId, ids[choice - 1]);
    if (!outfit) return { consumed: true, reply: 'No encontré ese outfit.' };
    const lines = [`✨ *${outfitTitle(outfit)}*`, ''];
    for (const link of outfit.garments) lines.push(garmentLabel(link.garment));
    if (outfit.ai_reason) lines.push('', `💬 ${outfit.ai_reason}`);
    lines.push('', '> Escribe otro número para ver otro · *volver*');
    return { consumed: true, reply: lines.join('\n') };
  }

  if (/^(mis outfits|outfits)$/.test(text)) return { consumed: true, reply: enterMyOutfits(ctx.userId) };
  // Anything else isn't a choice from this list: back to Fashion's home, which either takes it as
  // an outfit request or steps aside for a normal message.
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
  const { handleHome } = await import('./home.flow.js');
  return handleHome(ctx);
}
