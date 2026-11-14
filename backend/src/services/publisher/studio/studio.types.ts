/**
 * Brand studio - types and the catalogue of what can be made. Self-contained (part of the
 * publisher module): the identity (colors, type, logo) is per project and edited from the panel.
 */
export type DesignKind = 'logo' | 'cover' | 'profile' | 'post' | 'story';
export type DesignLayout = 'mark' | 'banner' | 'hero' | 'split' | 'tip' | 'quote';
export type DesignStatus = 'pending' | 'working' | 'review' | 'approved' | 'rejected' | 'error';
export type FontKey = 'modern' | 'elegant' | 'friendly' | 'bold';

export interface Colors {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  light: string;
}

export interface Identity {
  colors: Colors;
  style: string;
  font: FontKey;
  logoRef: string;
}

export interface DesignContent {
  headline?: string;
  sub?: string;
  bullets?: string[];
  cta?: string;
  /** What the image model should paint (no text in it: the texts are drawn by the studio). */
  art_prompt?: string;
}

export interface Design {
  id: number;
  kind: DesignKind;
  layout: DesignLayout;
  format: string;
  brief: string;
  use_ai: number;
  status: DesignStatus;
  detail: string;
  title: string;
  caption: string;
  content: DesignContent;
  file_ref: string;
  art_ref: string;
  created_by: number | null;
  created_at: string;
  approved_at: string | null;
}

export interface FormatSpec {
  key: string;
  kind: DesignKind;
  label: string;
  width: number;
  height: number;
  /** Aspect enum of the image model for the art. */
  art: 'square_hd' | 'portrait_16_9' | 'landscape_16_9' | 'portrait_4_3' | 'landscape_4_3';
  /** Share of the width/height that every network keeps visible (banners are cropped differently by device). */
  safe?: { w: number; h: number };
}

export const FORMATS: FormatSpec[] = [
  { key: 'logo', kind: 'logo', label: 'Logo (cuadrado)', width: 1024, height: 1024, art: 'square_hd' },
  { key: 'profile', kind: 'profile', label: 'Foto de perfil (cuadrada, se recorta en círculo)', width: 1080, height: 1080, art: 'square_hd' },
  { key: 'youtube-banner', kind: 'cover', label: 'Banner de YouTube (2560×1440)', width: 2560, height: 1440, art: 'landscape_16_9', safe: { w: 0.6, h: 0.29 } },
  { key: 'facebook-cover', kind: 'cover', label: 'Portada de Facebook (1640×624)', width: 1640, height: 624, art: 'landscape_16_9', safe: { w: 0.8, h: 0.8 } },
  { key: 'square', kind: 'post', label: 'Publicación cuadrada (1080×1080)', width: 1080, height: 1080, art: 'square_hd' },
  { key: 'portrait', kind: 'post', label: 'Publicación vertical (1080×1350)', width: 1080, height: 1350, art: 'portrait_4_3' },
  { key: 'story', kind: 'story', label: 'Historia / Reel / TikTok (1080×1920)', width: 1080, height: 1920, art: 'portrait_16_9' },
];

export const formatByKey = (key: string) => FORMATS.find((f) => f.key === key);

/** Layouts per kind. «uses art» = needs an image from the model; the others cost nothing. */
export const LAYOUTS: Record<DesignLayout, { label: string; usesArt: boolean; kinds: DesignKind[] }> = {
  mark: { label: 'Logo con símbolo', usesArt: true, kinds: ['logo', 'profile'] },
  banner: { label: 'Portada con arte', usesArt: true, kinds: ['cover'] },
  hero: { label: 'Foto completa con titular', usesArt: true, kinds: ['post', 'story', 'cover'] },
  split: { label: 'Mitad arte, mitad texto', usesArt: true, kinds: ['post', 'story'] },
  tip: { label: 'Consejo con puntos (sin IA)', usesArt: false, kinds: ['post', 'story'] },
  quote: { label: 'Frase grande (sin IA)', usesArt: false, kinds: ['post', 'story'] },
};

export const FONTS: Record<FontKey, { label: string; google: string; stack: string; weight: number }> = {
  modern: { label: 'Moderna (Inter)', google: 'Inter:wght@400;600;800', stack: "'Inter', 'Segoe UI', system-ui, sans-serif", weight: 800 },
  elegant: { label: 'Elegante (Playfair Display)', google: 'Playfair+Display:wght@500;700;800', stack: "'Playfair Display', Georgia, serif", weight: 700 },
  friendly: { label: 'Amigable (Poppins)', google: 'Poppins:wght@400;600;700', stack: "'Poppins', 'Segoe UI', system-ui, sans-serif", weight: 700 },
  bold: { label: 'Fuerte (Montserrat)', google: 'Montserrat:wght@500;700;900', stack: "'Montserrat', 'Segoe UI', system-ui, sans-serif", weight: 900 },
};

export const DEFAULT_COLORS: Colors = { primary: '#4B5CF6', secondary: '#EEF0FF', accent: '#F59E0B', dark: '#12163A', light: '#FFFFFF' };
