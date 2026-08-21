import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';

export const HOME_MENU = `👔 *Fashion Mode*

¿Qué quieres hacer?

1. 📸 Agregar prenda
2. 👗 Ver mi armario
3. ✨ Crear un outfit
4. ❤️ Mis outfits guardados
5. 🚪 Salir

También puedes escribir directo: "armario", "armario camisas", "agregar prenda", "outfit boda",
"mis outfits", "salir", o "actualizar ropa" para que revise de nuevo todas tus prendas guardadas
(color, ajuste, material y más).`;

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
  if (text === '5' || text === 'salir') {
    fashionSessionsRepo.clear(ctx.userId);
    return { consumed: true, reply: '👋 Saliste de Fashion Mode.' };
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
    return { consumed: true, reply: '¿Para qué ocasión? (ej. "oficina", "boda", "algo casual para una cena")' };
  }
  const outfitMatch = text.match(/^(?:crear\s+)?outfit\s+(.+)$/);
  const requestText = outfitMatch ? outfitMatch[1] : text;

  const { enterOutfitRequest } = await import('./outfit.flow.js');
  return { consumed: true, reply: await enterOutfitRequest(ctx, requestText) };
}
