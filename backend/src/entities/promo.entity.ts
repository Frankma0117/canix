/** One piece of advertising material (table promo_items, see services/promo/). */
export type PromoMedia = 'video' | 'image';
export type PromoKind = 'ad' | 'howto' | 'feature';
export type PromoStatus = 'pending' | 'working' | 'review' | 'approved' | 'rejected' | 'error';

/** A message of a drawn WhatsApp chat: the person ("me") or Canix. */
export interface ChatLine {
  from: 'me' | 'canix';
  text: string;
  /** Shown as a voice note bubble instead of text (the text becomes its transcript). */
  voice?: boolean;
}

/** One scene of a video: what it shows, the line on screen and what the narrator says. */
export interface PromoScene {
  shot: 'hook' | 'chat' | 'features' | 'steps' | 'cta' | 'end';
  text: string;
  say: string;
  chat?: ChatLine[];
  items?: string[];
}

export interface VideoContent {
  scenes: (PromoScene & { start?: number; dur?: number })[];
}

export interface ImageContent {
  headline: string;
  sub: string;
  bullets: string[];
  cta: string;
  chat: ChatLine[];
}

export interface PromoFile {
  /** Spaces key, or "local:<path under data/promo>" when Spaces isn't configured. */
  file: string;
  poster?: string;
  seconds?: number;
}

export interface PromoItem {
  id: number;
  media: PromoMedia;
  kind: PromoKind;
  feature: string | null;
  layout: string | null;
  formats: string[];
  idea: string;
  status: PromoStatus;
  detail: string;
  title: string;
  caption: string;
  content: Partial<VideoContent & ImageContent>;
  files: Record<string, PromoFile>;
  voice: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}
