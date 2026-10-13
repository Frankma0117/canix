import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { parseRequestLocally } from '../outfit/request.js';
import type { FashionSessionData } from '../types.js';

export const HOME_MENU = `👔 *Fashion Mode*
Escribe el *número*, o pídelo directo.

1️⃣  📸 Agregar prenda
2️⃣  👗 Ver mi armario
3️⃣  ✨ Crear un outfit
4️⃣  ❤️ Mis outfits guardados
5️⃣  🚪 Salir

> Sé tan específico como quieras:
> "outfit para una boda formal con blazer azul, sin corbata"
> "armario camisas blancas" · "zapatos favoritos"
> *actualizar ropa* revisa de nuevo todas tus prendas`;

const CLOTHES_WORDS_RE = /\b(outfit|pinta|look|ropa|prenda|prendas|pongo|ponerme|vestir|vestirme|visto|combina|combinar|armario|closet|conjunto|elegante|formal|informal|casual)\b/;

/** True when a free-text message plausibly asks for (or adjusts) an outfit: it names an occasion,
 *  a garment, a color, the weather... or uses a clothes word. */
export function isAboutClothes(text: string): boolean {
  const plain = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (CLOTHES_WORDS_RE.test(plain)) return true;
  // Mostly made of things an outfit request is made of - not one stray word that happens to be an
  // occasion ("agéndame una cita con el odontólogo").
  const read = parseRequestLocally(text);
  return read.understood > 0 && read.leftover.length <= read.understood;
}

export function enterHome(userId: number): string {
  fashionSessionsRepo.setState(userId, 'FASHION_HOME', {});
  return HOME_MENU;
}

export async function handleHome(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const text = ctx.text.trim().toLowerCase();

  if (text === '1' || /^agregar( prenda)?$/.test(text) || text === 'guardar ropa') {
    const { enterAddGarment } = await import('./add-garment.flow.js');
    return { consumed: true, reply: enterAddGarment(ctx.userId) };
  }
  if (text === '2' || /^(ver )?(mi )?armario$/.test(text) || /^mis prendas$/.test(text)) {
    const { enterWardrobeList } = await import('./list-garments.flow.js');
    return { consumed: true, reply: enterWardrobeList(ctx.userId, {}) };
  }
  if (text === '4' || /^mis outfits$/.test(text)) {
    const { enterMyOutfits } = await import('./outfit.flow.js');
    return { consumed: true, reply: enterMyOutfits(ctx.userId) };
  }
  if (/^(volver|menu|menú|inicio|atras|atrás|fashion|moda)$/.test(text)) {
    return { consumed: true, reply: HOME_MENU };
  }
  if (text === '5' || text === 'salir') {
    fashionSessionsRepo.clear(ctx.userId);
    return { consumed: true, reply: '👋 Saliste de Fashion Mode.\n\n> Escribe *fashion* cuando quieras volver' };
  }

  // "armario <filtro>" typed directly from home
  const wardrobeMatch = text.match(/^armario\s+(.+)$/);
  if (wardrobeMatch) {
    const { enterWardrobeList, parseFilterText } = await import('./list-garments.flow.js');
    return { consumed: true, reply: enterWardrobeList(ctx.userId, parseFilterText(wardrobeMatch[1])) };
  }

  // Option "3" alone (no description yet) asks for the occasion; anything else not matched above -
  // including "3 boda", "outfit boda", or free-form text like "algo elegante para una cena" - is
  // treated as an outfit request directly, per the user's own spec ("no un menú numérico forzado
  // si el lenguaje natural ya expresa la intención").
  if (text === '3' || /^(crear\s+)?outfit$/.test(text)) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', { awaitingOutfit: true } satisfies FashionSessionData);
    return {
      consumed: true,
      reply:
        '✨ *Crear un outfit*\n¿Para qué lo quieres? Dímelo con el detalle que tengas:\n\n' +
        '- La ocasión: "oficina", "boda", "una cena"\n' +
        '- El clima o qué tan formal: "con frío", "elegante", "relajado"\n' +
        '- Prendas que sí o que no: "con mis tenis blancos", "sin chaqueta"\n\n' +
        '> Ej. "cena elegante con frío, con el blazer, nada de negro"',
    };
  }
  const outfitMatch = text.match(/^(?:crear\s+)?outfit\s+(.+)$/);
  const requestText = outfitMatch ? outfitMatch[1] : text;

  // Not about clothes at all ("recuérdame llamar a mamá", "qué tengo mañana"): Fashion Mode steps
  // aside and the message is handled like any other - nobody has to type "salir" first.
  // (Right after "3. Crear un outfit" asked what it's for, whatever comes IS the answer.)
  const awaitingOutfit = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId).awaitingOutfit === true;
  if (!outfitMatch && !awaitingOutfit && !isAboutClothes(text)) {
    fashionSessionsRepo.clear(ctx.userId);
    return { consumed: false };
  }

  const { enterOutfitRequest } = await import('./outfit.flow.js');
  return { consumed: true, reply: await enterOutfitRequest(ctx, requestText) };
}
