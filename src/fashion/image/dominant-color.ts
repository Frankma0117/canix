import { runFfmpeg } from '../../audio/ffmpeg.js';

/**
 * The garment's main color, read straight from its photo - no AI, no extra service. People
 * photograph a garment laid out in the middle of the frame (a bed, a rug, the floor) with the room
 * around it, so only the middle of the picture is looked at, and pixels closer to the center count
 * more. Each pixel is named with one of the wardrobe's own colors and the name with the most
 * weight wins. This exists because the vision classifier labelled most of a real wardrobe
 * "multicolor" (or nothing at all), which left the outfit engine nothing to tell garments apart by.
 */
const GRID = 32;

/** Middle band looked at: narrower than tall, since shirts and trousers alike run down the frame. */
const CROP = 'crop=iw*0.36:ih*0.46:iw*0.32:ih*0.27';

async function centerPixels(image: Buffer): Promise<Buffer> {
  return runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', `${CROP},scale=${GRID}:${GRID}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], image);
}

function toHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/** One pixel -> the name of its color in the wardrobe's taxonomy (see taxonomy.ts's COLORS). */
export function nameColor(r: number, g: number, b: number): string {
  const [h, s, v] = toHsv(r, g, b);
  if (v < 0.14 || (v < 0.24 && s < 0.35)) return 'negro';
  if (s < 0.16) return v >= 0.6 ? 'blanco' : v < 0.3 ? 'negro' : 'gris';
  if (s < 0.28 && v >= 0.72 && (h < 70 || h > 330)) return 'beige'; // warm, pale
  if (s < 0.26) return v >= 0.72 ? 'blanco' : 'gris'; // a faint tint is lighting, not color
  if (h < 14 || h >= 345) return v < 0.48 ? 'vino' : 'rojo';
  if (h < 40) return v < 0.5 || s < 0.45 ? 'café' : 'naranja';
  if (h < 66) return v < 0.5 ? 'verde_oliva' : s < 0.45 ? 'beige' : 'amarillo';
  if (h < 165) return v < 0.45 || s < 0.4 ? 'verde_oliva' : 'verde';
  if (h < 196) return 'azul_claro';
  if (h < 255) return v < 0.4 ? 'azul_marino' : s < 0.42 && v > 0.62 ? 'azul_claro' : 'azul';
  if (h < 292) return 'morado';
  return v < 0.48 ? 'vino' : 'rosado';
}

export interface ColorReading {
  color: string;
  /** Share of the (center-weighted) picture that color takes, 0-1. */
  share: number;
  /** The runner-up, when it takes a real part of the garment too. */
  secondary?: string;
}

/** Never throws: a photo ffmpeg can't read simply has no reading. */
export async function dominantColor(image: Buffer): Promise<ColorReading | null> {
  let pixels: Buffer;
  try {
    pixels = await centerPixels(image);
  } catch {
    return null;
  }
  if (pixels.length < GRID * GRID * 3) return null;

  const weights = new Map<string, number>();
  let total = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = (y * GRID + x) * 3;
      const dx = (x - (GRID - 1) / 2) / (GRID / 2);
      const dy = (y - (GRID - 1) / 2) / (GRID / 2);
      const weight = Math.exp(-(dx * dx + dy * dy) * 1.6);
      const name = nameColor(pixels[i], pixels[i + 1], pixels[i + 2]);
      weights.set(name, (weights.get(name) ?? 0) + weight);
      total += weight;
    }
  }
  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const [color, weight] = ranked[0];
  const second = ranked[1];
  return { color, share: weight / total, ...(second && second[1] / total >= 0.22 ? { secondary: second[0] } : {}) };
}
