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
  providers: { key: string; label: string; available: boolean; oauth: boolean; loginName: string; configured: boolean; envVars: string[] }[];
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
  id: string;
  source: 'promo' | 'studio' | 'generated';
  media: 'video' | 'image';
  title: string;
  caption: string;
  url: string;
  poster: string;
}

export interface GenerationProvider { key: string; label: string; simulated: boolean; configured: boolean; envVars: string[]; active: boolean }
export interface GenerationStatus {
  image: GenerationProvider[];
  video: GenerationProvider[];
  maxVideoSeconds: number;
  usage: { costCapCents: number; spentCents: number };
}
export interface GeneratedAsset {
  id: number;
  media: 'image' | 'video';
  provider: string;
  simulated: boolean;
  title: string;
  status: 'working' | 'ready' | 'error';
  detail: string;
  url: string;
  costCents: number;
}

export interface PublisherResponse {
  brand: PublisherBrand;
  connections: PublisherConnection[];
  providers: { key: string; label: string; available: boolean }[];
  platforms: PublisherPlatform[];
  posts: PublisherPost[];
  assets: PublisherAsset[];
  generation: { cap: number; used: number; textAi: boolean };
  awaiting: number;
}

// ---------- brand studio (GET /api/admin/publisher/studio) ----------
export type DesignKind = 'logo' | 'cover' | 'profile' | 'post' | 'story';
export type DesignStatus = 'pending' | 'working' | 'review' | 'approved' | 'rejected' | 'error';

export interface StudioColors {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  light: string;
}

export interface StudioIdentity {
  colors: StudioColors;
  style: string;
  font: string;
  logoUrl: string;
}

export interface StudioDesign {
  id: number;
  kind: DesignKind;
  layout: string;
  format: string;
  formatLabel: string;
  brief: string;
  useAi: boolean;
  status: DesignStatus;
  detail: string;
  title: string;
  caption: string;
  content: { headline?: string; sub?: string; bullets?: string[]; cta?: string };
  url: string;
  createdAt: string;
}

export interface StudioStatus {
  canCompose: boolean;
  textAi: boolean;
  art: { key: 'fal' | 'mock'; label: string };
  identity: StudioIdentity;
  formats: { key: string; kind: DesignKind; label: string; width: number; height: number }[];
  layouts: { key: string; label: string; usesArt: boolean; kinds: DesignKind[] }[];
  fonts: { key: string; label: string }[];
  budget: { cap: number; used: number };
}

export interface StudioResponse {
  status: StudioStatus;
  designs: StudioDesign[];
}

// ---------- automation (GET /api/admin/publisher/automation) ----------
export type RunStatus = 'generating' | 'awaiting' | 'scheduled' | 'published' | 'partial' | 'failed' | 'skipped';

export interface AutomationSchedule {
  id: number;
  name: string;
  media: 'image' | 'video';
  format: string;
  layouts: string[];
  topics: string[];
  platforms: PublisherPlatform[];
  days: number[];
  time: string;
  leadHours: number;
  mode: 'approve' | 'auto';
  enabled: boolean;
  nextAt: string | null;
  missing: string[];
}

export interface AutomationRun {
  id: number;
  scheduleId: number;
  scheduleName: string;
  media: 'image' | 'video';
  publishAt: string | null;
  status: RunStatus;
  detail: string;
  title: string;
  preview: string;
  post: PublisherPost | null;
}

export interface AutomationOverview {
  timezone: string;
  schedules: AutomationSchedule[];
  runs: AutomationRun[];
  awaiting: number;
}
