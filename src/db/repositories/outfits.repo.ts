import { db } from '../pool.js';
import type { Outfit, OutfitGarment, Garment } from '../../types/index.js';

export interface OutfitWithGarments extends Outfit {
  garments: (OutfitGarment & { garment: Garment })[];
}

function attachGarments(userId: number, outfit: Outfit): OutfitWithGarments {
  const links = db.prepare('SELECT * FROM outfit_garments WHERE outfit_id = ?').all(outfit.id) as OutfitGarment[];
  const garments = links
    .map((link) => {
      const garment = db.prepare('SELECT * FROM garments WHERE id = ? AND user_id = ?').get(link.garment_id, userId) as
        | Garment
        | undefined;
      return garment ? { ...link, garment } : undefined;
    })
    .filter((g): g is OutfitGarment & { garment: Garment } => g !== undefined);
  return { ...outfit, garments };
}

export const outfitsRepo = {
  getById(userId: number, id: number): OutfitWithGarments | undefined {
    const outfit = db.prepare('SELECT * FROM outfits WHERE id = ? AND user_id = ?').get(id, userId) as Outfit | undefined;
    return outfit ? attachGarments(userId, outfit) : undefined;
  },

  list(userId: number, opts: { favorite?: boolean; limit: number; offset: number }): { rows: OutfitWithGarments[]; total: number } {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (opts.favorite) clauses.push('favorite = 1');
    const where = clauses.join(' AND ');

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM outfits WHERE ${where}`).get(...params) as { c: number }).c;
    const rows = (
      db.prepare(`SELECT * FROM outfits WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, opts.limit, opts.offset) as Outfit[]
    ).map((o) => attachGarments(userId, o));

    return { rows, total };
  },

  /** Creates a saved outfit from a role -> garmentId map (see fashion/outfit/recommendation.service.ts's
   *  output shape) - every garmentId here is expected to already be validated as belonging to this
   *  user and to a real, active garment (the caller, not this repo, is responsible for that check -
   *  see recommendation.service.ts's anti-hallucination validation). */
  create(
    userId: number,
    fields: { name?: string | null; occasion?: string | null; formality?: string | null; season?: string | null; style?: string | null; notes?: string | null; aiReason?: string | null },
    garmentRoles: { garmentId: number; role: string }[],
  ): number {
    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO outfits (user_id, name, occasion, formality, season, style, notes, ai_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          fields.name ?? null,
          fields.occasion ?? null,
          fields.formality ?? null,
          fields.season ?? null,
          fields.style ?? null,
          fields.notes ?? null,
          fields.aiReason ?? null,
        );
      const outfitId = Number(info.lastInsertRowid);
      const insertGarment = db.prepare('INSERT INTO outfit_garments (outfit_id, garment_id, role) VALUES (?, ?, ?)');
      for (const { garmentId, role } of garmentRoles) insertGarment.run(outfitId, garmentId, role);
      return outfitId;
    });
    return tx();
  },

  setFavorite(userId: number, id: number, favorite: boolean): void {
    db.prepare("UPDATE outfits SET favorite = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
      favorite ? 1 : 0,
      id,
      userId,
    );
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM outfits WHERE id = ? AND user_id = ?').run(id, userId); // cascades outfit_garments
  },
};
