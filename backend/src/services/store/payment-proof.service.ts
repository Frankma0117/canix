import { env } from '../../config/env.js';
import { mimeOfMedia } from './store-media.service.js';
import type { PaymentProofReading } from '../../entities/index.js';

/**
 * Reads a photo a customer sent and tells whether it is a payment receipt ("consignación",
 * transfer, Nequi / Daviplata / Bancolombia screenshot) and what it says: amount, bank, reference,
 * date. Uses the same vision LLM as the wardrobe (fal.ai, see services/fashion/vision/).
 *
 * It only READS. Whether the money actually arrived is always decided by a person of the business,
 * who sees the image and this reading side by side in the portal - a screenshot can be edited.
 *
 * Without a vision provider (no FAL_KEY) or when it fails, the image is still kept and attached to
 * the order as "comprobante por revisar", just without the extracted fields.
 */
const PROMPT = `Eres el asistente de caja de un negocio en Colombia. Un cliente envió esta imagen por WhatsApp. Di si es un COMPROBANTE DE PAGO (transferencia, consignación bancaria, pago por Nequi, Daviplata, Bancolombia, Davivienda, BBVA, Bre-B, PSE, datáfono...) y extrae sus datos.

Responde SOLO un objeto JSON, sin texto alrededor:
{
  "es_comprobante": true/false,
  "valor": número entero en pesos sin puntos ni símbolos (ej. 58000) o null si no se lee,
  "banco": "entidad o app por la que se pagó" o null,
  "referencia": "número de comprobante, referencia o aprobación" o null,
  "fecha": "fecha y hora tal como aparecen" o null,
  "pagador": "quien envía" o null,
  "destinatario": "nombre o número de la cuenta que recibe" o null,
  "descripcion": "una frase corta de lo que se ve en la imagen"
}

No inventes nada: lo que no se lea con claridad va en null. Si la imagen es otra cosa (una foto de un producto, una dirección, un pantallazo de chat), "es_comprobante" es false y explica en "descripcion" qué es.`;

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** "58.000", "$ 58,000.00", 58000 -> 58000. */
function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d.,]/g, '').replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, '');
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) ? n : null;
}

const text = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function proofReadingAvailable(): boolean {
  return !!env.fal.apiKey;
}

/** `expectedTotal` is the order's total, to say whether the amount read matches it. */
export async function readPaymentProof(image: Buffer, fileName: string, expectedTotal: number | null): Promise<PaymentProofReading | null> {
  if (!proofReadingAvailable()) return null;
  const { endpoint, model, timeoutMs } = env.fashion.llmVision;
  try {
    const res = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Key ${env.fal.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: PROMPT, image_url: `data:${mimeOfMedia(fileName)};base64,${image.toString('base64')}`, model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error('[STORE] Receipt reading failed: HTTP %d %s', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const body = (await res.json()) as { output?: string };
    const raw = parseJson(body.output ?? '');
    if (!raw) {
      console.error('[STORE] Receipt reading did not return JSON: %s', (body.output ?? '').slice(0, 200));
      return null;
    }
    const amount = parseAmount(raw.valor);
    return {
      isProof: raw.es_comprobante === true,
      amount,
      bank: text(raw.banco, 60),
      reference: text(raw.referencia, 60),
      date: text(raw.fecha, 60),
      payer: text(raw.pagador, 80),
      recipient: text(raw.destinatario, 80),
      seen: text(raw.descripcion, 200),
      amountMatches: amount !== null && expectedTotal !== null ? amount === expectedTotal : null,
    };
  } catch (err) {
    console.error('[STORE] Receipt reading failed:', (err as Error).message);
    return null;
  }
}
