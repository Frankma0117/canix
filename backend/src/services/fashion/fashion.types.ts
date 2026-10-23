import type { OutfitContext } from './outfit/candidate-filter.js';
import type { OutfitPick } from './outfit/rules.js';

/** An outfit as shown: the request it answers and the garments picked for it. */
export interface OutfitDraft {
  context: OutfitContext;
  picks: OutfitPick[];
  missingRoles: string[];
  missingMust?: { category: string; color?: string }[];
  reason: string;
}

/** Fashion Mode's conversational states - stored as plain text in fashion_sessions.state (see
 *  models/fashion-sessions.model.ts). A flat union, since fashion.router.ts dispatches with a plain
 *  switch. */
export type FashionState =
  | 'FASHION_IDLE'
  | 'FASHION_HOME'
  | 'FASHION_ADD_GARMENT_WAITING_IMAGE'
  | 'FASHION_ADD_GARMENT_ANALYZING'
  | 'FASHION_ADD_GARMENT_CONFIRMATION'
  | 'FASHION_ADD_GARMENT_MANUAL_TYPE'
  | 'FASHION_ADD_GARMENT_MANUAL_CATEGORY'
  | 'FASHION_ADD_GARMENT_MANUAL_COLOR'
  | 'FASHION_ADD_GARMENT_PDF_REVIEW'
  | 'FASHION_WARDROBE_LIST'
  | 'FASHION_GARMENT_DETAIL'
  | 'FASHION_EDIT_GARMENT_SELECT'
  | 'FASHION_EDIT_GARMENT_FIELD'
  | 'FASHION_DELETE_CONFIRM'
  | 'FASHION_DELETE_ALL_CONFIRM'
  | 'FASHION_OUTFIT_RESULT'
  | 'FASHION_MY_OUTFITS_LIST'
  | 'FASHION_PROFILE_WAITING_PHOTO';

/** A garment draft being built during the add-garment flow, held in fashion_sessions.data until
 *  confirmed. Mirrors garments.model.ts's create() fields but every value starts optional/unknown. */
export interface GarmentDraft {
  publicId: string;
  storageKey: string;
  imageUrl: string;
  thumbnailKey?: string | null;
  thumbnailUrl?: string | null;
  type?: string;
  category?: string;
  color?: string;
  secondaryColors?: string[];
  pattern?: string;
  style?: string[];
  formality?: string;
  fit?: string;
  material?: string;
  warmth?: string;
  waterResistance?: string;
  neckline?: string;
  sleeves?: string;
  closure?: string;
  pockets?: string;
  length?: string;
  /** Short catalog-style name and a longer natural-language paragraph, both generated purely from
   *  the structured fields above (see garment-description.ts) - never free-generated text, so
   *  nothing in them can be something the vision pipeline didn't actually detect. */
  shortDescription?: string;
  longDescription?: string;
  /** Per-field confidence/tier/certainty (see vision.service.ts's FieldMeta) - stored so the
   *  confirmation screen and the saved garment can both show "esto lo veo clarísimo" vs "esto es
   *  una estimación" instead of presenting every field the same way. */
  fieldMeta?: Record<string, { confidence: number; tier: string; certainty: string }>;
  /** Photo quality issues flagged before classification (see vision-service/quality.py) - used to
   *  give a specific, helpful message instead of a generic "no pude analizarla" fallback. */
  qualityIssues?: string[];
  /** Which CLIP model + taxonomy/pipeline version produced this draft's auto-detected fields, and
   *  when - see taxonomy.ts's ANALYSIS_VERSION. Absent entirely for a garment classified purely by
   *  hand (manual fallback cascade), which is honest: nothing to attribute to a model there. */
  analysisModel?: string;
  analysisVersion?: number;
  analyzedAt?: string;
  aiMetadata?: unknown;
  /** Which fields the vision service actually filled in (above the confidence floor) - drives the
   *  confirm-or-correct summary so we don't claim confidence in a field the user never provided
   *  and the model didn't confidently detect either. */
  detectedFields?: string[];
  // Only filled in by the vision LLM (see vision/llm-vision.service.ts).
  subcategory?: string;
  gender?: string;
  season?: string[];
  weather?: string[];
  occasions?: string[];
  brand?: string;
  /** What it wasn't sure about - saved as portal questions once the garment exists (services/fashion/review.ts). */
  doubts?: { field: string; question: string; options: string[]; suggested: string | null }[];
}

/** Session `data` shape per state - not every state uses all of these, but keeping one flat
 *  interface (all-optional) avoids a discriminated-union ceremony this feature doesn't need. */
export interface FashionSessionData {
  draft?: GarmentDraft;
  /** Bulk PDF import (see services/fashion/flows/add-garment-pdf.flow.ts): drafts extracted from a PDF,
   *  awaiting a single "guardar todas" or per-item correction. */
  pdfQueue?: GarmentDraft[];
  /** Set while correcting one item of pdfQueue via the same manual type/category/color cascade
   *  used for a single photo - tells that cascade's final step to splice the result back into
   *  pdfQueue and return to the PDF review screen, instead of the single-item confirmation. */
  pdfEditIndex?: number;
  /** Wardrobe list: current filter + pagination offset. */
  filter?: { type?: string; category?: string; color?: string; favorite?: boolean; search?: string };
  offset?: number;
  /** Ids of the garments last rendered to the user, in display order (1-based index -> real id) -
   *  so replies like "3" or "editar 2" never require exposing raw DB ids over WhatsApp. */
  lastListedIds?: number[];
  /** The garment currently in focus (detail/edit/delete flows). */
  selectedGarmentId?: number;
  /** Which field is being edited in FASHION_EDIT_GARMENT_FIELD / the manual-correction loop. */
  editingField?: string;
  /** The outfit on screen - what "guardar", "otra opción", a swap or a reaction act on (see
   *  flows/outfit.flow.ts). */
  outfit?: OutfitDraft;
  /** A garment waiting for "¿la elimino de tu armario?" to be answered. */
  pendingDeleteId?: number;
  /** A message that came after an outfit and could be an adjustment or something else entirely:
   *  kept while the person is asked which (see flows/outfit.flow.ts). */
  pendingFollowUp?: string;
  /** Home just asked "¿para qué lo quieres?" (option 3) - the next message is that answer, whatever it says. */
  awaitingOutfit?: boolean;
  /** Ids of saved outfits last rendered by "mis outfits" (same 1-based-index pattern as lastListedIds). */
  lastListedOutfitIds?: number[];
}
