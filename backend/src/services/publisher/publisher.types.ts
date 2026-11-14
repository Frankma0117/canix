/**
 * Content publisher - shared types. The whole module (services/publisher, its schema, routes and
 * the frontend page) is self-contained so it can be copied to another project: only the brand
 * profile, the connected accounts and the API keys change from one project to the next.
 */
export const PLATFORMS = ['youtube', 'instagram', 'facebook', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
export type TargetStatus = 'pending' | 'published' | 'failed';
export type MediaType = 'video' | 'image';

export interface Brand {
  name: string;
  tone: string;
  language: string;
  audience: string;
  cta: string;
  hashtags: string[];
  keywords: string[];
}

export interface SeoText {
  title: string;
  description: string;
  hashtags: string[];
}

export interface Connection {
  platform: Platform;
  provider: string;
  account_name: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: 'connected' | 'error';
  last_error: string;
  connected_at: string;
}

export interface Post {
  id: number;
  promo_item_id: number | null;
  media_type: MediaType;
  media_ref: string;
  thumbnail_ref: string;
  title: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  seo: Partial<Record<Platform, SeoText>>;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  created_by: number | null;
  created_at: string;
}

export interface Target {
  id: number;
  post_id: number;
  platform: Platform;
  status: TargetStatus;
  external_id: string | null;
  external_url: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string;
  published_at: string | null;
}

/** What a provider receives: the media plus the texts already adapted to its platform. */
export interface PublishRequest {
  mediaType: MediaType;
  mediaRef: string;
  thumbnailRef: string;
  text: SeoText;
  accessToken: string;
  accountName: string;
}

export interface PublishResult {
  externalId: string;
  externalUrl: string;
}

export interface ConnectResult {
  accountName: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

/**
 * One implementation per way of reaching a platform. Phase 1 ships the simulated one; the real
 * YouTube / Meta / TikTok providers plug in here without touching the queue, the SEO or the panel.
 */
export interface PublisherProvider {
  readonly key: string;
  readonly label: string;
  /** False for providers that are not built yet: the panel shows them as «próximamente». */
  readonly available: boolean;
  connect(platform: Platform, input: { accountName: string }): Promise<ConnectResult>;
  publish(platform: Platform, req: PublishRequest): Promise<PublishResult>;
}

/** Limits per platform used to trim the texts. */
export const PLATFORM_LIMITS: Record<Platform, { title: number; description: number; hashtags: number }> = {
  youtube: { title: 100, description: 5000, hashtags: 15 },
  instagram: { title: 90, description: 2200, hashtags: 30 },
  facebook: { title: 100, description: 2000, hashtags: 10 },
  tiktok: { title: 90, description: 2200, hashtags: 8 },
};
