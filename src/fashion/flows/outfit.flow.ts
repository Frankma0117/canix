import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { outfitsRepo } from '../../db/repositories/outfits.repo.js';
import { parseOutfitIntent } from '../outfit/intent.js';
import { recommendOutfit } from '../outfit/recommendation.service.js';
import { CATEGORIES_BY_TYPE, GARMENT_TYPE_LABELS } from '../taxonomy.js';
import type { GarmentType } from '../taxonomy.js';
import type { FashionSessionData } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

const ROLE_EMOJI: Record<string, string> = {
  TOP: '👕', BOTTOM: '👖', FULL_BODY: '👗', OUTERWEAR: '🧥', FOOTWEAR: '👞', ACCESSORY: '⌚',
};

function categoryLabel(category: string): string {
  for (const cats of Object.values(CATEGORIES_BY_TYPE)) {
    const match = cats.find((c) => c.value === category);
    if (match) return match.label;
  }
  return category;
}

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

  const context = await parseOutfitIntent(ctx.userId, rawText);
  const result = await recommendOutfit(ctx.userId, context);

  if (result.emptyWardrobe) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return `Todavía no tienes prendas guardadas - agrega algunas primero con "agregar prenda".\n\n${HOME_MENU}`;
  }

  return renderResult(ctx, context as Record<string, unknown>, result.picks, result.missingRoles, result.reason);
}

async function renderResult(
  ctx: FashionRouterContext,
  context: Record<string, unknown>,
  picks: { garmentId: number; role: GarmentType }[],
  missingRoles: GarmentType[],
  reason: string,
): Promise<string> {
  fashionSessionsRepo.setState(ctx.userId, 'FASHION_OUTFIT_RESULT', {
    outfit: { context, picks, missingRoles, reason },
  } satisfies FashionSessionData);

  if (picks.length === 0) {
    return `No tengo suficientes prendas compatibles para armarte un outfit todavía.\n\n1. Volver`;
  }

  const lines = ['✨ *Outfit recomendado*', ''];
  const imagesToSend: { url: string; caption: string }[] = [];

  for (const pick of picks) {
    const garment = garmentsRepo.getById(ctx.userId, pick.garmentId);
    if (!garment) continue;
    const emoji = ROLE_EMOJI[pick.role] ?? '👕';
    lines.push(`${emoji} ${categoryLabel(garment.category)}${garment.color ? ` ${garment.color}` : ''}`);
    imagesToSend.push({ url: garment.thumbnail_url || garment.image_url, caption: `${emoji} ${categoryLabel(garment.category)}` });
  }

  for (const role of missingRoles) {
    lines.push(`⚠️ No tienes ${GARMENT_TYPE_LABELS[role].toLowerCase()} adecuado para esto todavía.`);
  }

  if (reason) lines.push('', `¿Por qué? ${reason}`);
  lines.push('', '1. Guardar este outfit', '2. Dame otra opción', '3. Volver');

  // Best-effort, never blocks the text summary above (which already went out via the returned
  // reply) - a few photos, not the whole wardrobe, matching the "no enviar todo de golpe" spirit.
  Promise.all(imagesToSend.slice(0, 5).map((img) => ctx.wa.sendImage(ctx.jid, img.url, img.caption))).catch(() => {});

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
    return { consumed: true, reply: `✅ Outfit #${id} guardado.\n\n${HOME_MENU}` };
  }

  if (text === '2' || /^otra/i.test(text)) {
    const { recommendOutfit } = await import('../outfit/recommendation.service.js');
    const result = await recommendOutfit(ctx.userId, outfit.context, { forceNew: true });
    if (result.emptyWardrobe || result.picks.length === 0) {
      return { consumed: true, reply: 'No tengo otra combinación distinta para ofrecerte con lo que tienes guardado.\n\n1. Guardar este outfit\n2. Dame otra opción\n3. Volver' };
    }
    const reply = await renderResult(ctx, outfit.context, result.picks, result.missingRoles, result.reason);
    return { consumed: true, reply };
  }

  return { consumed: true, reply: '1. Guardar este outfit\n2. Dame otra opción\n3. Volver' };
}

export function enterMyOutfits(userId: number): string {
  const { rows, total } = outfitsRepo.list(userId, { limit: 10, offset: 0 });
  fashionSessionsRepo.setState(userId, 'FASHION_MY_OUTFITS_LIST', {
    lastListedOutfitIds: rows.map((o) => o.id),
  } satisfies FashionSessionData);

  if (total === 0) return 'No tienes outfits guardados todavía.\n\n1. Volver';

  const lines = ['❤️ *Tus outfits guardados*', ''];
  rows.forEach((o, i) => {
    const fav = o.favorite ? ' ❤️' : '';
    const label = o.occasion ?? o.name ?? `Outfit #${o.id}`;
    lines.push(`${i + 1}. ${label}${fav} (${o.garments.length} prenda${o.garments.length === 1 ? '' : 's'})`);
  });
  lines.push('', 'Responde con un número para ver el detalle, o "volver".');
  return lines.join('\n');
}

export async function handleMyOutfitsList(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const text = ctx.text.trim().toLowerCase();

  if (text === 'volver' || text === '1') {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  const ids = data.lastListedOutfitIds ?? [];
  const choice = Number(text);
  if (Number.isInteger(choice) && choice >= 1 && choice <= ids.length) {
    const outfit = outfitsRepo.getById(ctx.userId, ids[choice - 1]);
    if (!outfit) return { consumed: true, reply: 'No encontré ese outfit.' };
    const lines = [`${outfit.occasion ?? outfit.name ?? `Outfit #${outfit.id}`}${outfit.favorite ? ' ❤️' : ''}`, ''];
    for (const link of outfit.garments) {
      lines.push(`${ROLE_EMOJI[link.role] ?? '👕'} ${categoryLabel(link.garment.category)}${link.garment.color ? ` ${link.garment.color}` : ''}`);
    }
    if (outfit.ai_reason) lines.push('', outfit.ai_reason);
    lines.push('', '(vuelve a escribir "mis outfits" para ver la lista de nuevo)');
    return { consumed: true, reply: lines.join('\n') };
  }

  return { consumed: true, reply: enterMyOutfits(ctx.userId) };
}
