/** Advertising material (GET /api/admin/promo) - see backend/src/services/promo/. */
export type PromoMedia = 'video' | 'image';
export type PromoKind = 'ad' | 'howto' | 'feature';
export type PromoStatus = 'pending' | 'working' | 'review' | 'approved' | 'rejected' | 'error';

export interface PromoChatLine {
  from: 'me' | 'canix';
  text: string;
  voice?: boolean;
}

export interface PromoItem {
  id: number;
  media: PromoMedia;
  kind: PromoKind;
  feature: string | null;
  featureName: string | null;
  layout: string | null;
  formats: string[];
  status: PromoStatus;
  detail: string;
  idea: string;
  title: string;
  caption: string;
  content: {
    scenes?: { shot: string; text: string; say: string }[];
    headline?: string;
    sub?: string;
    bullets?: string[];
    cta?: string;
    chat?: PromoChatLine[];
  };
  voice: string | null;
  files: Record<string, { url: string; poster: string; seconds: number | null }>;
  createdAt: string;
}

export interface PromoStatusInfo {
  canRender: boolean;
  textAi: boolean;
  voice: boolean;
  music: boolean;
  storage: 'spaces' | 'local';
  voices: { key: string; name: string; gender: 'male' | 'female'; style: string }[];
  voiceKey: string;
  musicOptions: { key: string; name: string }[];
  musicKey: string;
  features: { key: string; name: string; emoji: string }[];
}

export interface PromoResponse {
  items: PromoItem[];
  status: PromoStatusInfo;
}
