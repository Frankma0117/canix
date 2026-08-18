import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { garmentsRepo } from '../../db/repositories/garments.repo.js';
import { spacesStorageService } from '../storage/spaces-storage.service.js';
import type { FashionSessionData } from '../types.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

export function enterDeleteConfirm(userId: number, garmentId: number): string {
  fashionSessionsRepo.setState(userId, 'FASHION_DELETE_CONFIRM', { selectedGarmentId: garmentId } satisfies FashionSessionData);
  return '⚠️ ¿Seguro que quieres eliminar esta prenda? Esto no se puede deshacer.\n\n1. Sí, eliminar\n2. No';
}

export async function handleDeleteConfirm(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const data = fashionSessionsRepo.getData<FashionSessionData>(ctx.userId);
  const garmentId = data.selectedGarmentId;
  if (!garmentId) {
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    return { consumed: true, reply: HOME_MENU };
  }

  const text = ctx.text.trim();

  if (text === '1' || /^s(i|í)/i.test(text)) {
    const removed = garmentsRepo.remove(ctx.userId, garmentId); // scoped to ctx.userId - a no-op if it isn't actually this user's garment
    fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
    if (!removed) return { consumed: true, reply: `No encontré esa prenda.\n\n${HOME_MENU}` };
    await spacesStorageService.delete([removed.storageKey, removed.thumbnailKey].filter((k): k is string => !!k));
    console.log('[FASHION] Prenda #%d eliminada para el usuario #%d.', garmentId, ctx.userId);
    return { consumed: true, reply: `🗑️ Prenda eliminada.\n\n${HOME_MENU}` };
  }

  if (text === '2' || /^no/i.test(text)) {
    const { showGarmentDetail } = await import('./edit-garment.flow.js');
    return { consumed: true, reply: showGarmentDetail(ctx.userId, garmentId) };
  }

  return { consumed: true, reply: '1. Sí, eliminar\n2. No' };
}
