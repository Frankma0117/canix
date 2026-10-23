/** Fashion Mode (armario/outfits) - see backend/src/services/fashion/. Taxonomy values (type/category/style/etc.)
 *  are validated at the app layer against backend/src/services/fashion/taxonomy.ts, not a DB CHECK constraint, so
 *  new categories are a one-line code change instead of a migration. */
export interface Garment {
  id: number;
  user_id: number;
  // Fingerprint of the photo and when its color was read from it - see services/fashion/upkeep.ts.
  image_hash: string | null;
  color_checked_at: string | null;
  /** Failed tries at classifying it with the vision LLM - see services/fashion/review.ts. */
  llm_attempts: number;
  /** Last day it was worn ('YYYY-MM-DD') - worn this week keeps it out of outfits (services/fashion/worn.ts). */
  worn_on: string | null;
  public_id: string;
  storage_key: string;
  image_url: string;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  type: string;
  category: string;
  subcategory: string | null;
  gender: string | null;
  color: string | null;
  secondary_colors: string | null; // JSON array
  pattern: string | null;
  material: string | null;
  fit: string | null;
  style: string | null; // JSON array
  formality: string | null;
  season: string | null; // JSON array
  weather: string | null; // JSON array
  occasions: string | null; // JSON array
  brand: string | null;
  size: string | null;
  condition: string | null;
  warmth: string | null;
  water_resistance: string | null;
  neckline: string | null;
  sleeves: string | null;
  length: string | null;
  closure: string | null;
  pockets: string | null;
  short_description: string | null;
  long_description: string | null;
  analysis_confidence: string | null; // JSON: Record<field, FieldMeta> - see vision.service.ts
  analysis_model: string | null;
  analysis_version: number | null;
  analyzed_at: string | null;
  is_active: number;
  favorite: number;
  notes: string | null;
  ai_metadata: string | null; // JSON: raw vision-service response, audit/debug only
  created_at: string;
  updated_at: string;
}

/** One row per user (1:1) - Fashion Mode's own conversational state (FASHION_HOME,
 *  FASHION_ADD_GARMENT_WAITING_IMAGE, etc. - see backend/src/services/fashion/fashion.types.ts).
 * @public */
export interface FashionSession {
  user_id: number;
  state: string;
  data: string; // JSON
  updated_at: string;
}

/** Styling profile feeding the outfit recommendation engine - see fashion-profile.model.ts /
 *  set-fashion-profile.tool.ts.
 * @public */
export interface FashionProfile {
  user_id: number;
  height_cm: number | null;
  build: string | null; // see taxonomy.ts's BODY_BUILDS
  size: string | null; // see taxonomy.ts's SIZES
  preferred_colors: string | null; // JSON array
  avoided_colors: string | null; // JSON array
  preferred_styles: string | null; // JSON array
  reference_photo_key: string | null;
  reference_photo_url: string | null;
  updated_at: string;
}

/** A saved combination of garments - only persisted when the user explicitly saves one (see
 *  services/fashion/flows/outfit.flow.ts).
 * @public */
export interface Outfit {
  id: number;
  user_id: number;
  name: string | null;
  occasion: string | null;
  formality: string | null;
  season: string | null;
  style: string | null;
  notes: string | null;
  favorite: number;
  ai_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** @public - domain record shape, read by its model. */
export interface OutfitGarment {
  id: number;
  outfit_id: number;
  garment_id: number;
  role: string; // matches backend/src/services/fashion/taxonomy.ts's GarmentType
}
