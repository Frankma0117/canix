import { randomUUID } from 'node:crypto';
import { fashionSessionsRepo } from '../../db/repositories/fashion-sessions.repo.js';
import { fashionProfileRepo } from '../../db/repositories/fashion-profile.repo.js';
import { intakeGarmentImage } from '../image/image-intake.js';
import { spacesStorageService } from '../storage/spaces-storage.service.js';
import type { FashionRouterContext, FashionRouterResult } from '../router-types.js';
import { HOME_MENU } from './home.flow.js';

/** Raw-command entry vocabulary for saving a reference photo (the "fotos del cliente" the user
 *  asked for) - matched whole-string in router.ts, same discipline as every other Fashion Mode
 *  entry keyword. Deliberately NOT auto-analyzed by the CLIP vision model like a garment photo: a
 *  fashion-garment classifier isn't built or validated for reasoning about a PERSON's body/skin
 *  tone, and guessing there would be both unreliable and a much more sensitive kind of wrong to get
 *  wrong than misreading a shirt's color. It's kept purely as a saved reference image; the
 *  structured profile fields (talla/contextura/altura/colores, see set-fashion-profile.tool.ts) are
 *  what the recommendation engine actually reasons over.
 */
export const PROFILE_PHOTO_KEYWORDS = ['foto de referencia', 'foto referencia', 'mi foto', 'foto del cliente', 'subir foto de perfil', 'foto de perfil'];

export function enterProfilePhoto(userId: number): string {
  fashionSessionsRepo.setState(userId, 'FASHION_PROFILE_WAITING_PHOTO', {});
  return (
    '📸 Mándame una foto de referencia (tuya o de la persona para la que estás armando el armario).\n\n' +
    'La guardo tal cual, para tenerla a mano - no la analizo automáticamente (eso queda para las prendas). ' +
    'Escribe "cancelar" si te arrepentiste.'
  );
}

export async function handleProfilePhotoWaiting(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  if (!ctx.imageMessage) {
    if (/^cancelar$/i.test(ctx.text.trim())) {
      fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
      return { consumed: true, reply: `Cancelado.\n\n${HOME_MENU}` };
    }
    if (ctx.text.trim()) {
      return { consumed: true, reply: 'Necesito que me mandes una FOTO (o escribe "cancelar").' };
    }
    return { consumed: true };
  }

  const intake = await intakeGarmentImage(ctx.imageMessage);
  if ('error' in intake) {
    return { consumed: true, reply: intake.error };
  }

  const publicId = `profile-${randomUUID()}`;
  try {
    const upload = await spacesStorageService.uploadOriginal(ctx.userId, publicId, intake.original, intake.mimetype, 'jpg');
    fashionProfileRepo.setReferencePhoto(ctx.userId, upload.key, upload.url);
    console.log('[FASHION] Foto de referencia guardada para #%d.', ctx.userId);
  } catch (err) {
    console.error('[FASHION] Error subiendo la foto de referencia:', (err as Error).message);
    return { consumed: true, reply: 'No pude guardar la foto. Inténtalo nuevamente.' };
  }

  fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
  return { consumed: true, reply: `✅ Foto de referencia guardada.\n\n${HOME_MENU}` };
}
