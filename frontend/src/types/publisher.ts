/** Content publisher (GET /api/admin/publisher) - see backend/src/services/publisher/. */
export type PublisherPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';

export interface SeoText {
  title: string;
  description: string;
  hashtags: string[];
}

export interface PublisherBrand {
  name: string;
  tone: string;
  language: string;
  audience: string;
  cta: string;
  hashtags: string[];
  keywords: string[];
}

export interface PublisherConnection {
  platform: PublisherPlatform;
  name: string;
  connected: boolean;
  status: 'connected' | 'error' | null;
  accountName: string;
  provider: string | null;
  lastError: string;
  connectedAt: string | null;
  providers: { key: string; label: string; available: boolean; oauth: boolean; configured: boolean; envVars: string[] }[];
}

export interface PublisherTarget {
  platform: PublisherPlatform;
  name: string;
  status: 'pending' | 'published' | 'failed';
  url: string | null;
  attempts: number;
  error: string;
  nextAttemptAt: string | null;
  publishedAt: string | null;
}

export interface PublisherPost {
  id: number;
  promoItemId: number | null;
  mediaType: 'video' | 'image';
  mediaUrl: string;
  thumbnailUrl: string;
  title: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  seo: Partial<Record<PublisherPlatform, SeoText>>;
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  platforms: PublisherPlatform[];
  targets: PublisherTarget[];
  createdAt: string | null;
}

export interface PublisherAsset {
  id: number;
  media: 'video' | 'image';
  title: string;
  caption: string;
  url: string;
  poster: string;
}

export interface PublisherResponse {
  brand: PublisherBrand;
  connections: PublisherConnection[];
  providers: { key: string; label: string; available: boolean }[];
  platforms: PublisherPlatform[];
  posts: PublisherPost[];
  assets: PublisherAsset[];
  generation: { cap: number; used: number; textAi: boolean };
}
