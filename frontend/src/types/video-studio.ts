export type Pose = 'wave' | 'point' | 'celebrate' | 'idle' | 'none';
export type Format = '9x16' | '16x9' | '1x1';

export interface Callout {
  x: number;
  y: number;
  text: string;
}

export interface Scene {
  image: string;
  title: string;
  sub?: string;
  callouts?: Callout[];
  mascot?: { pose: Pose; side?: 'left' | 'right' };
  seconds?: number;
  /** What the mascot says in this scene (voice comes in a later phase). */
  say?: string;
}

export interface VideoSpec {
  brand: { name: string; from: string; mid: string; to: string; accent: string; bgFrom: string; bgTo: string; logo: string; mascot: string };
  format: Format;
  intro: { title: string; sub?: string; seconds?: number; say?: string };
  scenes: Scene[];
  outro: { title: string; cta: string; seconds?: number; say?: string };
  /** "Paso N de M" badge and progress bar on each scene. */
  guide?: boolean;
}

export type VideoStatus = 'draft' | 'previewing' | 'rendering' | 'review' | 'approved' | 'error';

export interface StudioVideo {
  id: number;
  title: string;
  spec: VideoSpec;
  status: VideoStatus;
  detail: string;
  url: string;
  has_preview: boolean;
  group_id: string | null;
  kind: string;
  created_at: string;
  updated_at: string;
}

export interface StudioResponse {
  items: StudioVideo[];
  available: boolean;
  template: VideoSpec;
  assets: { path: string; project: string }[];
}
