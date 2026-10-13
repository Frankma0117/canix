import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';

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

  const { enterOutfitRequest } = await import('./outfit.flow.js');
  return { consumed: true, reply: await enterOutfitRequest(ctx, requestText) };
}
