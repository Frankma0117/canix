/** Fashion Mode's conversational states - stored as plain text in fashion_sessions.state (see
 *  db/repositories/fashion-sessions.repo.ts). Kept as a flat union rather than a class hierarchy
 *  since router.ts's dispatch is a simple switch, matching this codebase's preference for plain
 *  data over abstraction (see CLAUDE.md-equivalent guidance: no premature abstraction). */
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
  | 'FASHION_OUTFIT_RESULT'
  | 'FASHION_MY_OUTFITS_LIST';

/** A garment draft being built during the add-garment flow, held in fashion_sessions.data until
 *  confirmed. Mirrors garments.repo.ts's create() fields but every value starts optional/unknown. */
export interface GarmentDraft {
  publicId: string;
  storageKey: string;
  imageUrl: string;
  thumbnailKey?: string | null;
  thumbnailUrl?: string | null;
  type?: string;
  category?: string;
  color?: string;
  pattern?: string;
  style?: string[];
  formality?: string;
  aiMetadata?: unknown;
  /** Which fields the vision service actually filled in (above the confidence floor) - drives the
   *  confirm-or-correct summary so we don't claim confidence in a field the user never provided
   *  and the model didn't confidently detect either. */
  detectedFields?: string[];
}

/** Session `data` shape per state - not every state uses all of these, but keeping one flat
 *  interface (all-optional) avoids a discriminated-union ceremony this feature doesn't need. */
export interface FashionSessionData {
  draft?: GarmentDraft;
  /** Bulk PDF import (see fashion/flows/add-garment-pdf.flow.ts): drafts extracted from a PDF,
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
  /** The last outfit recommendation shown - kept so "1. Guardar"/"2. Otra opción" can act on it
   *  without recomputing (see fashion/flows/outfit.flow.ts). */
  outfit?: {
    context: Record<string, unknown>;
    picks: { garmentId: number; role: string }[];
    missingRoles: string[];
    reason: string;
  };
  /** Ids of saved outfits last rendered by "mis outfits" (same 1-based-index pattern as lastListedIds). */
  lastListedOutfitIds?: number[];
}
