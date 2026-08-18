import { downloadMediaMessage, type WAMessage } from 'baileys';
import { env } from '../../config/env.js';

export interface PdfIntakeResult {
  buffer: Buffer;
}

/** Same "is this actually a PDF" check the router uses before calling intakeGarmentPdf - kept
 *  here too since a caller could feed this any document, not just one already filtered. */
export function isPdfDocument(message: WAMessage): boolean {
  const doc = message.message?.documentMessage;
  if (!doc) return false;
  return doc.mimetype === 'application/pdf' || (doc.fileName?.toLowerCase().endsWith('.pdf') ?? false);
}

/**
 * Downloads an incoming WhatsApp PDF document and validates its size - mirrors
 * image-intake.ts's intakeGarmentImage(), just for the bulk-import-by-PDF flow (see
 * fashion/flows/add-garment-pdf.flow.ts). The PDF itself is never stored anywhere (not in Spaces,
 * not on disk) - only the individual images extracted from it go through the normal
 * upload/analyze pipeline.
 */
export async function intakeGarmentPdf(message: WAMessage): Promise<PdfIntakeResult | { error: string }> {
  let buffer: Buffer;
  try {
    buffer = (await downloadMediaMessage(message, 'buffer', {})) as Buffer;
  } catch (err) {
    console.error('[FASHION] Error descargando el PDF:', (err as Error).message);
    return { error: 'No pude descargar el PDF. ¿Me lo mandas de nuevo?' };
  }

  const maxBytes = env.fashion.maxPdfSizeMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return { error: `Ese PDF pesa demasiado (máximo ${env.fashion.maxPdfSizeMb}MB) - ¿me mandas uno más liviano o las fotos sueltas?` };
  }

  return { buffer };
}
