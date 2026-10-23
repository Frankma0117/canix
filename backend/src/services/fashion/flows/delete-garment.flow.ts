import { fashionSessionsModel } from '../../../models/fashion-sessions.model.js';
import { garmentsModel } from '../../../models/garments.model.js';
import { spacesStorageService } from '../storage/spaces-storage.service.js';
import type { FashionSessionData } from '../fashion.types.js';
import type { FashionRouterContext, FashionRouterResult } from '../fashion-router.types.js';
import { HOME_MENU } from './home.flow.js';

export function enterDeleteConfirm(userId: number, garmentId: number): string {
  fashionSessionsModel.setState(userId, 'FASHION_DELETE_CONFIRM', { selectedGarmentId: garmentId } satisfies FashionSessionData);
  return '⚠️ ¿Seguro que quieres eliminar esta prenda? Esto no se puede deshacer.\n\n1. Sí, eliminar\n2. No';
}

export async function handleDeleteConfirm(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsModel.getData<FashionSessionData>(ctx.userId);
  const garmentId = data.selectedGarmentId;
  if (!garmentId) {
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  const text = ctx.text.trim();

  if (text === '1' || /^s(i|í)/i.test(text)) {
    const removed = garmentsModel.remove(ctx.userId, garmentId); // scoped to ctx.userId - a no-op if it isn't actually this user's garment
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    if (!removed) return { consumed: true, reply: `No encontré esa prenda.\n\n${HOME_MENU}` };
    await spacesStorageService.delete([removed.storageKey, removed.thumbnailKey].filter((k): k is string => !!k));
    console.log('[FASHION] Garment #%d deleted for user #%d.', garmentId, ctx.userId);
    return { consumed: true, reply: `🗑️ Prenda eliminada.\n\n${HOME_MENU}` };
  }

  if (text === '2' || /^no/i.test(text)) {
    const { showGarmentDetail } = await import('./edit-garment.flow.js');
    return { consumed: true, reply: showGarmentDetail(ctx.userId, garmentId) };
  }

  return { consumed: true, reply: '1. Sí, eliminar\n2. No' };
}

/** Raw-command entry vocabulary for wiping the ENTIRE wardrobe at once - matched whole-string in
 *  router.ts, same discipline as revalidate/profile-photo. Deliberately distinct from `/reset
 *  outfit` (which also wipes saved outfits, the styling profile, and the session, and needs the
 *  exact confirmation phrase typed back) - this is scoped to just the garments themselves, for the
 *  narrower "estas prendas ya no existen, vacía el armario" case the user asked for, with a plain
 *  yes/no confirmation instead. */
export const DELETE_ALL_KEYWORDS = ['borrar todas las prendas', 'eliminar todas las prendas', 'vaciar armario', 'borrar armario completo'];

export function enterDeleteAllConfirm(userId: number): string {
  const count = garmentsModel.listAllActive(userId).length;
  if (count === 0) return 'Tu armario ya está vacío - no hay nada que borrar.';
  fashionSessionsModel.setState(userId, 'FASHION_DELETE_ALL_CONFIRM', {});
  return (
    `⚠️ ¿Seguro que quieres eliminar TODAS tus ${count} prenda(s) guardadas? Esto no se puede deshacer ` +
    `(tus outfits guardados y tu perfil de estilo NO se tocan, solo las prendas).\n\n1. Sí, borrar todo\n2. No`
  );
}

export async function handleDeleteAllConfirm(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const text = ctx.text.trim();

  if (text === '1' || /^s(i|í)/i.test(text)) {
    const garments = garmentsModel.listAllActive(ctx.userId);
    const storageKeys: string[] = [];
    for (const g of garments) {
      const removed = garmentsModel.remove(ctx.userId, g.id);
      if (removed) {
        storageKeys.push(removed.storageKey);
        if (removed.thumbnailKey) storageKeys.push(removed.thumbnailKey);
      }
    }
    await spacesStorageService.delete(storageKeys);
    fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
    console.log('[FASHION] User #%d emptied their wardrobe (%d garment(s) deleted).', ctx.userId, garments.length);
    return { consumed: true, reply: `🗑️ Listo, eliminé ${garments.length} prenda(s). Tu armario quedó vacío.\n\n${HOME_MENU}` };
  }

  fashionSessionsModel.setState(ctx.userId, 'FASHION_HOME', {});
  return { consumed: true, reply: `Cancelado, no borré nada.\n\n${HOME_MENU}` };
}
