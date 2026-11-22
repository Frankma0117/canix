import { AccessError } from '../../models/permissions.model.js';

/** Contract shared with the Remotion taller (taller/src/lib/spec.ts). Keep both in sync. */
export const POSES = ['wave', 'point', 'celebrate', 'idle', 'none'] as const;
export const FORMATS = ['9x16', '16x9', '1x1'] as const;
export type Pose = (typeof POSES)[number];
export type Format = (typeof FORMATS)[number];

export interface Callout { x: number; y: number; text: string }
export interface Scene { image: string; title: string; sub?: string; callouts?: Callout[]; mascot?: { pose: Pose; side?: 'left' | 'right' }; seconds?: number }
export interface Brand { name: string; from: string; mid: string; to: string; accent: string; bgFrom: string; bgTo: string; logo: string; mascot: string }
export interface VideoSpec {
  brand: Brand;
  format: Format;
  intro: { title: string; sub?: string; seconds?: number };
  scenes: Scene[];
  outro: { title: string; cta: string; seconds?: number };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
// Only files inside taller/public/proyectos/<project>/..., no traversal.
const ASSET = /^proyectos\/[a-z0-9_-]+\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$/;

const text = (v: unknown, max: number, field: string, required = true): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw new AccessError(`Falta ${field}.`);
  if (s.length > max) throw new AccessError(`${field} es demasiado largo (máximo ${max}).`);
  return s;
};
const num = (v: unknown, min: number, max: number, field: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new AccessError(`${field} debe estar entre ${min} y ${max}.`);
  return n;
};
const asset = (v: unknown, field: string): string => {
  const s = text(v, 200, field);
  if (!ASSET.test(s) || s.includes('..')) throw new AccessError(`${field} no es una imagen válida.`);
  return s;
};
const color = (v: unknown, field: string): string => {
  const s = text(v, 7, field);
  if (!COLOR.test(s)) throw new AccessError(`${field} debe ser un color #rrggbb.`);
  return s;
};

/** Validates and normalizes what the editor sends; anything unknown is dropped. */
export function parseSpec(raw: unknown): VideoSpec {
  const r = (raw ?? {}) as Record<string, any>;
  const b = (r.brand ?? {}) as Record<string, unknown>;
  const mascotRaw = text(b.mascot, 200, 'La mascota', false) || 'canix';
  const brand: Brand = {
    name: text(b.name, 40, 'El nombre de la marca'),
    from: color(b.from, 'Color inicial'), mid: color(b.mid, 'Color medio'), to: color(b.to, 'Color final'), accent: color(b.accent, 'Color de acento'),
    bgFrom: color(b.bgFrom, 'Fondo inicial'), bgTo: color(b.bgTo, 'Fondo final'),
    logo: asset(b.logo, 'El logo'),
    mascot: mascotRaw === 'canix' ? 'canix' : asset(mascotRaw, 'La mascota'),
  };
  const format = FORMATS.includes(r.format) ? (r.format as Format) : '9x16';
  if (!Array.isArray(r.scenes) || r.scenes.length < 1 || r.scenes.length > 10) throw new AccessError('El video necesita entre 1 y 10 escenas.');
  const scenes: Scene[] = r.scenes.map((s: Record<string, any>, i: number) => {
    const callouts = Array.isArray(s?.callouts) ? s.callouts : [];
    if (callouts.length > 5) throw new AccessError(`La escena ${i + 1} admite hasta 5 recuadros.`);
    const pose = POSES.includes(s?.mascot?.pose) ? (s.mascot.pose as Pose) : 'none';
    return {
      image: asset(s?.image, `La imagen de la escena ${i + 1}`),
      title: text(s?.title, 60, `El título de la escena ${i + 1}`),
      sub: text(s?.sub, 90, `El subtítulo de la escena ${i + 1}`, false) || undefined,
      callouts: callouts.map((c: Record<string, unknown>) => ({
        x: num(c?.x, 0, 100, 'La posición X') ?? 50,
        y: num(c?.y, 0, 100, 'La posición Y') ?? 50,
        text: text(c?.text, 60, `El texto de un recuadro de la escena ${i + 1}`),
      })),
      mascot: { pose, side: s?.mascot?.side === 'left' ? 'left' : 'right' },
      seconds: num(s?.seconds, 1.5, 15, 'Los segundos de la escena'),
    };
  });
  return {
    brand,
    format,
    intro: { title: text(r.intro?.title, 50, 'El título de la intro'), sub: text(r.intro?.sub, 90, 'El subtítulo de la intro', false) || undefined, seconds: num(r.intro?.seconds, 1, 8, 'Los segundos de la intro') },
    scenes,
    outro: { title: text(r.outro?.title, 60, 'El título del cierre'), cta: text(r.outro?.cta, 60, 'El llamado a la acción'), seconds: num(r.outro?.seconds, 1, 8, 'Los segundos del cierre') },
  };
}

/** Starting point for a new Canix video (same story as the first promo). */
export function canixTemplate(): VideoSpec {
  const img = (n: string) => `proyectos/canix/imagenes/frontend_public_promo_screens_${n}.jpg`;
  return {
    brand: { name: 'Canix', from: '#2f8bff', mid: '#5b4cf5', to: '#8b3fe4', accent: '#5ff0ff', bgFrom: '#0d1030', bgTo: '#2a1566', logo: 'proyectos/canix/marca/frontend_public_logo-canix.png', mascot: 'canix' },
    format: '9x16',
    intro: { title: 'Canix', sub: 'Tu asistente en WhatsApp' },
    scenes: [
      { image: img('m-home'), title: 'Todo en un solo lugar', sub: 'Escríbele a Canix por WhatsApp', callouts: [{ x: 50, y: 14, text: 'Tu día de un vistazo' }, { x: 50, y: 45, text: 'Tareas y recordatorios' }], mascot: { pose: 'wave', side: 'right' } },
      { image: img('m-reminders'), title: 'Recordatorios que sí llegan', callouts: [{ x: 50, y: 25, text: 'Pídelos por mensaje o voz' }], mascot: { pose: 'point', side: 'right' } },
    ],
    outro: { title: 'Empieza hoy, gratis', cta: 'canix.cania.app' },
  };
}
