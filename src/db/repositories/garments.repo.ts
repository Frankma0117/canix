import { db } from '../pool.js';
import type { Garment } from '../../types/index.js';

export interface GarmentFilters {
  type?: string;
  category?: string;
  color?: string;
  favorite?: boolean;
  search?: string; // matches category/color/brand/notes
}

export interface GarmentCreateFields {
  publicId: string;
  storageKey: string;
  imageUrl: string;
  thumbnailKey?: string | null;
  thumbnailUrl?: string | null;
  type: string;
  category: string;
  subcategory?: string | null;
  gender?: string | null;
  color?: string | null;
  secondaryColors?: string[] | null;
  pattern?: string | null;
  material?: string | null;
  fit?: string | null;
  style?: string[] | null;
  formality?: string | null;
  season?: string[] | null;
  weather?: string[] | null;
  occasions?: string[] | null;
  brand?: string | null;
  size?: string | null;
  condition?: string | null;
  warmth?: string | null;
  waterResistance?: string | null;
  neckline?: string | null;
  sleeves?: string | null;
  length?: string | null;
  closure?: string | null;
  pockets?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  analysisConfidence?: unknown;
  analysisModel?: string | null;
  analysisVersion?: number | null;
  analyzedAt?: string | null;
  notes?: string | null;
  aiMetadata?: unknown;
}

export type GarmentUpdateFields = Partial<Omit<GarmentCreateFields, 'publicId' | 'storageKey' | 'imageUrl' | 'thumbnailKey' | 'thumbnailUrl'>>;

export const garmentsRepo = {
  getById(userId: number, id: number): Garment | undefined {
    return db.prepare('SELECT * FROM garments WHERE id = ? AND user_id = ? AND is_active = 1').get(id, userId) as
      | Garment
      | undefined;
  },

  getByPublicId(userId: number, publicId: string): Garment | undefined {
    return db
      .prepare('SELECT * FROM garments WHERE public_id = ? AND user_id = ? AND is_active = 1')
      .get(publicId, userId) as Garment | undefined;
  },

  create(userId: number, fields: GarmentCreateFields): number {
    const info = db
      .prepare(
        `INSERT INTO garments
         (user_id, public_id, storage_key, image_url, thumbnail_key, thumbnail_url, type, category, subcategory,
          gender, color, secondary_colors, pattern, material, fit, style, formality, season, weather, occasions,
          brand, size, condition, warmth, water_resistance, neckline, sleeves, length, closure, pockets,
          short_description, long_description, analysis_confidence, analysis_model, analysis_version, analyzed_at,
          notes, ai_metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        fields.publicId,
        fields.storageKey,
        fields.imageUrl,
        fields.thumbnailKey ?? null,
        fields.thumbnailUrl ?? null,
        fields.type,
        fields.category,
        fields.subcategory ?? null,
        fields.gender ?? null,
        fields.color ?? null,
        fields.secondaryColors ? JSON.stringify(fields.secondaryColors) : null,
        fields.pattern ?? null,
        fields.material ?? null,
        fields.fit ?? null,
        fields.style ? JSON.stringify(fields.style) : null,
        fields.formality ?? null,
        fields.season ? JSON.stringify(fields.season) : null,
        fields.weather ? JSON.stringify(fields.weather) : null,
        fields.occasions ? JSON.stringify(fields.occasions) : null,
        fields.brand ?? null,
        fields.size ?? null,
        fields.condition ?? null,
        fields.warmth ?? null,
        fields.waterResistance ?? null,
        fields.neckline ?? null,
        fields.sleeves ?? null,
        fields.length ?? null,
        fields.closure ?? null,
        fields.pockets ?? null,
        fields.shortDescription ?? null,
        fields.longDescription ?? null,
        fields.analysisConfidence !== undefined ? JSON.stringify(fields.analysisConfidence) : null,
        fields.analysisModel ?? null,
        fields.analysisVersion ?? null,
        fields.analyzedAt ?? null,
        fields.notes ?? null,
        fields.aiMetadata !== undefined ? JSON.stringify(fields.aiMetadata) : null,
      );
    return Number(info.lastInsertRowid);
  },

  /** Every active garment for a user, unfiltered/unpaginated - used by the outfit recommendation
   *  pipeline (see fashion/outfit/candidate-filter.ts) to do its own local, zero-AI-cost filtering
   *  in JS (occasion/formality/season/weather are JSON array columns, not cheap to query directly
   *  in SQL) - fine for a personal wardrobe's realistic size (dozens to low hundreds of garments). */
  listAllActive(userId: number): Garment[] {
    return db.prepare('SELECT * FROM garments WHERE user_id = ? AND is_active = 1').all(userId) as Garment[];
  },

  list(userId: number, filters: GarmentFilters = {}, opts: { limit: number; offset: number }): { rows: Garment[]; total: number } {
    const clauses: string[] = ['user_id = ?', 'is_active = 1'];
    const params: unknown[] = [userId];

    if (filters.type) {
      clauses.push('type = ?');
      params.push(filters.type);
    }
    if (filters.category) {
      clauses.push('category = ?');
      params.push(filters.category);
    }
    if (filters.color) {
      clauses.push('color = ?');
      params.push(filters.color);
    }
    if (filters.favorite) {
      clauses.push('favorite = 1');
    }
    if (filters.search) {
      // long_description folds in nearly every structured field as prose (material, fit, pattern,
      // style, neckline...) - matching against it is a cheap, no-infrastructure stand-in for real
      // semantic search (see the user's own "no agregues infraestructura compleja sin justificarla"
      // - embeddings/vector search would be exactly that, unjustified for a personal wardrobe's size).
      clauses.push(
        '(category LIKE ? COLLATE NOCASE OR color LIKE ? COLLATE NOCASE OR brand LIKE ? COLLATE NOCASE OR ' +
          'notes LIKE ? COLLATE NOCASE OR long_description LIKE ? COLLATE NOCASE)',
      );
      const like = `%${filters.search}%`;
      params.push(like, like, like, like, like);
    }

    const where = clauses.join(' AND ');
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM garments WHERE ${where}`).get(...params) as { c: number }).c;
    const rows = db
      .prepare(`SELECT * FROM garments WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as Garment[];

    return { rows, total };
  },

  update(userId: number, id: number, fields: GarmentUpdateFields): void {
    const current = this.getById(userId, id);
    if (!current) return;
    db.prepare(
      `UPDATE garments SET
        type = ?, category = ?, subcategory = ?, gender = ?, color = ?, secondary_colors = ?, pattern = ?,
        material = ?, fit = ?, style = ?, formality = ?, season = ?, weather = ?, occasions = ?, brand = ?,
        size = ?, condition = ?, warmth = ?, water_resistance = ?, neckline = ?, sleeves = ?, length = ?,
        closure = ?, pockets = ?, short_description = ?, long_description = ?, analysis_confidence = ?,
        analysis_model = ?, analysis_version = ?, analyzed_at = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(
      fields.type ?? current.type,
      fields.category ?? current.category,
      fields.subcategory === undefined ? current.subcategory : fields.subcategory,
      fields.gender === undefined ? current.gender : fields.gender,
      fields.color === undefined ? current.color : fields.color,
      fields.secondaryColors === undefined ? current.secondary_colors : fields.secondaryColors ? JSON.stringify(fields.secondaryColors) : null,
      fields.pattern === undefined ? current.pattern : fields.pattern,
      fields.material === undefined ? current.material : fields.material,
      fields.fit === undefined ? current.fit : fields.fit,
      fields.style === undefined ? current.style : fields.style ? JSON.stringify(fields.style) : null,
      fields.formality === undefined ? current.formality : fields.formality,
      fields.season === undefined ? current.season : fields.season ? JSON.stringify(fields.season) : null,
      fields.weather === undefined ? current.weather : fields.weather ? JSON.stringify(fields.weather) : null,
      fields.occasions === undefined ? current.occasions : fields.occasions ? JSON.stringify(fields.occasions) : null,
      fields.brand === undefined ? current.brand : fields.brand,
      fields.size === undefined ? current.size : fields.size,
      fields.condition === undefined ? current.condition : fields.condition,
      fields.warmth === undefined ? current.warmth : fields.warmth,
      fields.waterResistance === undefined ? current.water_resistance : fields.waterResistance,
      fields.neckline === undefined ? current.neckline : fields.neckline,
      fields.sleeves === undefined ? current.sleeves : fields.sleeves,
      fields.length === undefined ? current.length : fields.length,
      fields.closure === undefined ? current.closure : fields.closure,
      fields.pockets === undefined ? current.pockets : fields.pockets,
      fields.shortDescription === undefined ? current.short_description : fields.shortDescription,
      fields.longDescription === undefined ? current.long_description : fields.longDescription,
      fields.analysisConfidence === undefined ? current.analysis_confidence : JSON.stringify(fields.analysisConfidence),
      fields.analysisModel === undefined ? current.analysis_model : fields.analysisModel,
      fields.analysisVersion === undefined ? current.analysis_version : fields.analysisVersion,
      fields.analyzedAt === undefined ? current.analyzed_at : fields.analyzedAt,
      fields.notes === undefined ? current.notes : fields.notes,
      id,
      userId,
    );
  },

  setFavorite(userId: number, id: number, favorite: boolean): void {
    db.prepare("UPDATE garments SET favorite = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
      favorite ? 1 : 0,
      id,
      userId,
    );
  },

  /** Deletes the DB row (not a soft-delete) and returns its storage keys so the caller can best-
   *  effort clean up Spaces afterward - DB delete happens first on purpose: a failed Spaces
   *  cleanup just leaves a harmless orphaned object, while the reverse order risks a broken image
   *  reference the user can still see. */
  remove(userId: number, id: number): { storageKey: string; thumbnailKey: string | null } | undefined {
    const garment = this.getById(userId, id);
    if (!garment) return undefined;
    db.prepare('DELETE FROM garments WHERE id = ? AND user_id = ?').run(id, userId);
    return { storageKey: garment.storage_key, thumbnailKey: garment.thumbnail_key };
  },
};
