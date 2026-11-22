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
}

export interface VideoSpec {
  brand: { name: string; from: string; mid: string; to: string; accent: string; bgFrom: string; bgTo: string; logo: string; mascot: string };
  format: Format;
  intro: { title: string; sub?: string; seconds?: number };
  scenes: Scene[];
  outro: { title: string; cta: string; seconds?: number };
}

export type VideoStatus = 'draft' | 'rendering' | 'review' | 'approved' | 'error';

export interface StudioVideo {
  id: number;
  title: string;
  spec: VideoSpec;
  status: VideoStatus;
  detail: string;
  url: string;
  created_at: string;
  updated_at: string;
}

export interface StudioResponse {
  items: StudioVideo[];
  available: boolean;
  template: VideoSpec;
  assets: { path: string; project: string }[];
}
