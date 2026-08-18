import { downloadMediaMessage, type WAMessage } from 'baileys';
import { env } from '../../config/env.js';
import { toAnalysisCopy, toThumbnail } from './image-processing.js';

export interface IntakeResult {
  original: Buffer;
  mimetype: string;
  analysisCopy: Buffer;
  thumbnail: Buffer;
}

/** Maps a WhatsApp image mimetype to a safe file extension for the Spaces object key. */
export function extensionForMimetype(mimetype: string | undefined): string {
  if (mimetype?.includes('png')) return 'png';
  if (mimetype?.includes('webp')) return 'webp';
  return 'jpg'; // WhatsApp almost always sends JPEG
}

/**
 * Downloads an incoming WhatsApp image, validates its size, and produces both a compressed
 * analysis copy and a thumbnail (see image-processing.ts) - all before anything is written to
 * Spaces or the DB, so a bad/oversized/corrupt image never leaves an orphaned object behind.
 * ffmpeg failing on `analysisCopy`/`thumbnail` IS the "is this really a valid image" check - no
 * separate validation library is needed for that.
 */
export async function intakeGarmentImage(message: WAMessage): Promise<IntakeResult | { error: string }> {
  const mimetype = message.message?.imageMessage?.mimetype;

  let original: Buffer;
  try {
    original = (await downloadMediaMessage(message, 'buffer', {})) as Buffer;
  } catch (err) {
    console.error('[FASHION] Error descargando la imagen:', (err as Error).message);
    return { error: 'No pude descargar la foto. ¿Me la mandas de nuevo?' };
  }

  const maxBytes = env.fashion.maxImageSizeMb * 1024 * 1024;
  if (original.length > maxBytes) {
    return { error: `Esa foto pesa demasiado (máximo ${env.fashion.maxImageSizeMb}MB) - ¿me mandas una más liviana?` };
  }

  try {
    const [analysisCopy, thumbnail] = await Promise.all([toAnalysisCopy(original), toThumbnail(original)]);
    return { original, mimetype: mimetype ?? 'image/jpeg', analysisCopy, thumbnail };
  } catch (err) {
    console.error('[FASHION] Error procesando la imagen:', (err as Error).message);
    return { error: 'Eso no parece ser una imagen válida - ¿me la mandas de nuevo?' };
  }
}
