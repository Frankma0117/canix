import { db } from '../pool.js';
import type { FashionProfile } from '../../types/index.js';

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export const fashionProfileRepo = {
  get(userId: number): FashionProfile | undefined {
    return db.prepare('SELECT * FROM fashion_profiles WHERE user_id = ?').get(userId) as FashionProfile | undefined;
  },

  preferredColors(userId: number): string[] {
    return parseJsonArray(this.get(userId)?.preferred_colors ?? null);
  },

  avoidedColors(userId: number): string[] {
    return parseJsonArray(this.get(userId)?.avoided_colors ?? null);
  },

  preferredStyles(userId: number): string[] {
    return parseJsonArray(this.get(userId)?.preferred_styles ?? null);
  },

  /** Partial update - only the fields actually passed are touched, everything else keeps its
   *  current value (same undefined-keeps-current convention as garmentsRepo.update). */
  upsert(
    userId: number,
    fields: Partial<{
      heightCm: number | null;
      build: string | null;
      size: string | null;
      preferredColors: string[] | null;
      avoidedColors: string[] | null;
      preferredStyles: string[] | null;
    }>,
  ): void {
    const current = this.get(userId);
    const next = {
      heightCm: fields.heightCm !== undefined ? fields.heightCm : (current?.height_cm ?? null),
      build: fields.build !== undefined ? fields.build : (current?.build ?? null),
      size: fields.size !== undefined ? fields.size : (current?.size ?? null),
      preferredColors: fields.preferredColors !== undefined ? fields.preferredColors : parseJsonArray(current?.preferred_colors ?? null),
      avoidedColors: fields.avoidedColors !== undefined ? fields.avoidedColors : parseJsonArray(current?.avoided_colors ?? null),
      preferredStyles: fields.preferredStyles !== undefined ? fields.preferredStyles : parseJsonArray(current?.preferred_styles ?? null),
    };

    db.prepare(
      `INSERT INTO fashion_profiles (user_id, height_cm, build, size, preferred_colors, avoided_colors, preferred_styles, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         height_cm = excluded.height_cm, build = excluded.build, size = excluded.size,
         preferred_colors = excluded.preferred_colors, avoided_colors = excluded.avoided_colors,
         preferred_styles = excluded.preferred_styles, updated_at = excluded.updated_at`,
    ).run(
      userId,
      next.heightCm,
      next.build,
      next.size,
      next.preferredColors?.length ? JSON.stringify(next.preferredColors) : null,
      next.avoidedColors?.length ? JSON.stringify(next.avoidedColors) : null,
      next.preferredStyles?.length ? JSON.stringify(next.preferredStyles) : null,
    );
  },

  setReferencePhoto(userId: number, key: string, url: string): void {
    db.prepare(
      `INSERT INTO fashion_profiles (user_id, reference_photo_key, reference_photo_url, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         reference_photo_key = excluded.reference_photo_key, reference_photo_url = excluded.reference_photo_url,
         updated_at = excluded.updated_at`,
    ).run(userId, key, url);
  },
};
