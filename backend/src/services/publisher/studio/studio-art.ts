import { deflateSync } from 'node:zlib';
import { env } from '../../../config/env.js';
import type { Colors, FormatSpec, Identity } from './studio.types.js';

/**
 * The art behind a design: an image model paints it (fal.ai · FLUX) or, without a key, a plain
 * gradient in the brand colors stands in (free; the panel says it's a sample). The model never
 * draws text - the studio writes every word itself, so nothing comes out misspelled.
 * .env: FAL_KEY (shared with the rest of the project), STUDIO_IMAGE_MODEL (default fal-ai/flux/dev),
 * STUDIO_ART_PROVIDER = fal | mock (default: fal when FAL_KEY exists).
 */
export interface ArtProvider {
  readonly key: 'fal' | 'mock';
  readonly label: string;
  paint(prompt: string, aspect: FormatSpec['art'], colors: Colors): Promise<Buffer>;
}

const falProvider: ArtProvider = {
  key: 'fal',
  label: 'IA de imagen (FLUX · fal.ai)',
  async paint(prompt, aspect) {
    const model = process.env.STUDIO_IMAGE_MODEL?.trim() || 'fal-ai/flux/dev';
    const res = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${env.fal.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: aspect, num_images: 1, enable_safety_checker: true, output_format: 'jpeg' }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as { images?: { url?: string }[]; detail?: unknown };
    if (!res.ok) throw new Error(`fal.ai respondió ${res.status}${typeof body.detail === 'string' ? `: ${body.detail}` : ''}.`);
    const url = body.images?.[0]?.url;
    if (!url) throw new Error('fal.ai no devolvió ninguna imagen.');
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error('No se pudo descargar la imagen generada.');
    return Buffer.from(await img.arrayBuffer());
  },
};

// ---------- a plain PNG gradient, no dependencies ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
const rgb = (hex: string): [number, number, number] => {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '4B5CF6';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const SIZES: Record<FormatSpec['art'], [number, number]> = { square_hd: [256, 256], portrait_16_9: [144, 256], landscape_16_9: [256, 144], portrait_4_3: [192, 256], landscape_4_3: [256, 192] };

const mockProvider: ArtProvider = {
  key: 'mock',
  label: 'Arte de muestra (degradado de la marca)',
  async paint(_prompt, aspect, colors) {
    const [w, h] = SIZES[aspect];
    const a = rgb(colors.primary);
    const b = rgb(colors.dark);
    const c = rgb(colors.accent);
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const t = (x / w + y / h) / 2;
        const glow = Math.max(0, 1 - Math.hypot(x / w - 0.8, y / h - 0.2) * 2.6) * 0.45; // a soft accent light
        for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round((a[k] * (1 - t) + b[k] * t) * (1 - glow) + c[k] * glow);
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // 8 bits
    ihdr[9] = 2; // RGB
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  },
};

export const artProviders = { fal: falProvider, mock: mockProvider };

export function currentArtProvider(): ArtProvider {
  const wanted = process.env.STUDIO_ART_PROVIDER?.trim();
  if (wanted === 'mock') return mockProvider;
  return env.fal.apiKey ? falProvider : mockProvider;
}

/** The text sent to the image model. It describes the picture only - never words to write. */
export function artPrompt(identity: Identity, brandName: string, subject: string | undefined, kind: string): string {
  const palette = `palette of ${identity.colors.primary}, ${identity.colors.accent} and ${identity.colors.dark}`;
  const noText = 'No text, no letters, no numbers, no watermark, no logo.';
  if (kind === 'logo') {
    return `A minimal flat vector logo symbol for the brand "${brandName || 'the brand'}"${subject ? `, inspired by: ${subject}` : ''}. One simple bold geometric mark, centered, plenty of empty space around it, solid flat ${identity.colors.primary} background, mark in white and ${identity.colors.accent}. ${identity.style ? `Style: ${identity.style}.` : ''} ${noText}`;
  }
  return `${subject || 'An abstract, modern brand background'}. ${identity.style ? `Visual style: ${identity.style}.` : 'Clean, modern, professional commercial photography or illustration.'} Color ${palette}. Composition with calm empty areas where text can be placed. High quality, sharp. ${noText}`;
}
