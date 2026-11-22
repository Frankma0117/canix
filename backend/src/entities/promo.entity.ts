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
  shot: 'hook' | 'chat' | 'features' | 'steps' | 'screen' | 'cta' | 'end';
  text: string;
  say: string;
  chat?: ChatLine[];
  items?: string[];
  /** 'screen' shot: name of a portal screenshot (frontend/public/promo/screens/<name>.jpg), the area to highlight [x, y, w, h] as 0-1 fractions, and the label of that area. */
  screen?: string;
  focus?: [number, number, number, number];
  note?: string;
}

/** A change the administrator asked for after seeing a version (kept as the piece's history). */
export interface PromoRevision {
  at: string;
  note: string;
}

export interface VideoContent {
  scenes: (PromoScene & { start?: number; dur?: number })[];
  /** Narration clips already paid for, by hash(voice + text): a redraw only records the scenes that changed. */
  voiceCache?: Record<string, string>;
  /** Automatic quality warnings of the last render (see promo-qa.ts). */
  qa?: { level: 'warn' | 'error'; msg: string }[];
  /** What the stage needs to draw the video (timeline included): lets the portal preview edits without recording. */
  stage?: { total: number; host: string; feature: unknown; scenes: object[] };
  revisions?: PromoRevision[];
  /** A change asked in plain words, applied to the script by the worker on the next redraw. */
  change?: string;
  /** Files of the version before the last redraw, to compare them. */
  prev?: Record<string, PromoFile>;
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
