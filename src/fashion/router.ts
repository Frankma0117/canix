import { fashionSessionsRepo } from '../db/repositories/fashion-sessions.repo.js';
import { enterHome, handleHome, HOME_MENU } from './flows/home.flow.js';
import { enterAddGarment, handleWaitingImage, handleManualType, handleManualCategory, handleManualColor, handleConfirmation } from './flows/add-garment.flow.js';
import { enterWardrobeList, handleWardrobeList, parseFilterText } from './flows/list-garments.flow.js';
import { handleGarmentDetail, handleEditSelect, handleEditField } from './flows/edit-garment.flow.js';
import { handleDeleteConfirm } from './flows/delete-garment.flow.js';
import { enterOutfitRequest, handleOutfitResult, enterMyOutfits, handleMyOutfitsList } from './flows/outfit.flow.js';
import { enterPdfImport, handlePdfReview } from './flows/add-garment-pdf.flow.js';
import { isPdfDocument } from './image/pdf-intake.js';
import type { FashionRouterContext, FashionRouterResult } from './router-types.js';
import type { FashionState } from './types.js';

const ENTRY_KEYWORDS = ['fashion', 'moda', 'outfit'];
const WARDROBE_KEYWORDS = ['armario'];
const EXIT_KEYWORDS = ['salir', 'salir fashion', 'exit fashion', 'cancelar'];

/** First-word/whole-phrase match (not substring) against Fashion Mode's entry vocabulary - see
 *  bot-manager.ts for where this gates whether the router is even consulted. */
function matchFashionEntry(text: string): { matched: boolean; wardrobe: boolean; myOutfits: boolean; trailing: string } {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'guardar ropa' || /^agregar prenda$/.test(trimmed)) return { matched: true, wardrobe: false, myOutfits: false, trailing: '' };
  if (/^mis outfits$/.test(trimmed)) return { matched: true, wardrobe: false, myOutfits: true, trailing: '' };
  if (/^mis prendas$/.test(trimmed)) return { matched: true, wardrobe: true, myOutfits: false, trailing: '' };

  const firstWord = trimmed.split(/\s+/)[0] ?? '';
  const rest = trimmed.slice(firstWord.length).trim();

  if (WARDROBE_KEYWORDS.includes(firstWord)) return { matched: true, wardrobe: true, myOutfits: false, trailing: rest };
  if (ENTRY_KEYWORDS.includes(firstWord)) return { matched: true, wardrobe: false, myOutfits: false, trailing: rest };

  return { matched: false, wardrobe: false, myOutfits: false, trailing: '' };
}

/**
 * Fashion Mode's entire routing surface - called from bot-manager.ts BEFORE the AI/tool-calling
 * loop, entirely gated behind env.fashion.enabled. Pure state-machine dispatch, no LLM involved for
 * the wizard steps (garment CRUD, menus) - the ONE place any Fashion flow spends AI tokens is the
 * outfit-recommendation pipeline itself (see outfit/recommendation.service.ts), and even that only
 * calls out when a local match/cache doesn't already cover it. Returns `consumed: false` when the
 * text isn't Fashion-related at all (only possible when session state is already idle), letting
 * bot-manager.ts fall through to the normal AI loop unchanged.
 */
export async function handleFashionMessage(ctx: FashionRouterContext): Promise<FashionRouterResult> {
  const session = fashionSessionsRepo.getOrIdle(ctx.userId);
  const textLower = ctx.text.trim().toLowerCase();

  if (session.state !== 'FASHION_IDLE' && EXIT_KEYWORDS.includes(textLower)) {
    fashionSessionsRepo.clear(ctx.userId);
    console.log('[FASHION] Usuario #%d salió de Fashion Mode.', ctx.userId);
    return { consumed: true, reply: '👋 Saliste de Fashion Mode.' };
  }

  // A PDF is unambiguous - nothing else in this bot does anything with one, so it's routed here
  // regardless of current state (mirrors how a bare garment photo mid-flow is handled), even from
  // idle. Any other document type is simply not this module's concern and falls through untouched.
  if (ctx.documentMessage && isPdfDocument(ctx.documentMessage)) {
    console.log('[FASHION] Usuario #%d envió un PDF.', ctx.userId);
    return { consumed: true, reply: await enterPdfImport(ctx) };
  }

  if (session.state === 'FASHION_IDLE') {
    const entry = matchFashionEntry(ctx.text);
    if (!entry.matched) return { consumed: false };

    console.log('[FASHION] Usuario #%d entró a Fashion Mode.', ctx.userId);
    if (entry.wardrobe) {
      return { consumed: true, reply: enterWardrobeList(ctx.userId, parseFilterText(entry.trailing)) };
    }
    if (entry.myOutfits) {
      return { consumed: true, reply: enterMyOutfits(ctx.userId) };
    }
    const reply = entry.trailing.trim() ? await routeHomeShortcut(ctx, entry.trailing.trim()) : enterHome(ctx.userId);
    return { consumed: true, reply };
  }

  // Already mid-flow: every message belongs to Fashion Mode until it exits, regardless of content
  // (including a bare image, handled explicitly per-state below).
  return dispatch(session.state as FashionState, ctx);
}

/** "fashion outfit boda"/"fashion armario"/"outfit boda"-style shortcuts typed on entry, straight
 *  past the home menu - "outfit <algo>" runs the real recommendation pipeline directly. */
async function routeHomeShortcut(ctx: FashionRouterContext, trailing: string): Promise<string> {
  if (/^armario/.test(trailing) || /^prendas/.test(trailing)) {
    return enterWardrobeList(ctx.userId, parseFilterText(trailing.replace(/^(armario|prendas)\s*/, '')));
  }
  if (/^agregar/.test(trailing)) {
    return enterAddGarment(ctx.userId);
  }
  if (/^outfits?/.test(trailing)) {
    return enterMyOutfits(ctx.userId);
  }
  return enterOutfitRequest(ctx, trailing);
}

async function dispatch(state: FashionState, ctx: FashionRouterContext): Promise<FashionRouterResult> {
  switch (state) {
    case 'FASHION_HOME':
      return handleHome(ctx);
    case 'FASHION_ADD_GARMENT_WAITING_IMAGE':
      return handleWaitingImage(ctx);
    case 'FASHION_ADD_GARMENT_ANALYZING':
      // A message arriving while still "analyzing" means the previous attempt crashed/hung before
      // reaching confirmation (see add-garment.flow.ts / add-garment-pdf.flow.ts - analysis
      // normally completes synchronously within one handler call, for both a single photo and a
      // PDF batch) - treat it as stale and restart the wait instead of stranding the user in a
      // dead state.
      fashionSessionsRepo.setState(ctx.userId, 'FASHION_ADD_GARMENT_WAITING_IMAGE', {});
      return { consumed: true, reply: 'Tuve un problema procesando lo anterior - ¿me lo mandas de nuevo?' };
    case 'FASHION_ADD_GARMENT_MANUAL_TYPE':
      return handleManualType(ctx);
    case 'FASHION_ADD_GARMENT_MANUAL_CATEGORY':
      return handleManualCategory(ctx);
    case 'FASHION_ADD_GARMENT_MANUAL_COLOR':
      return handleManualColor(ctx);
    case 'FASHION_ADD_GARMENT_CONFIRMATION':
      return handleConfirmation(ctx);
    case 'FASHION_ADD_GARMENT_PDF_REVIEW':
      return handlePdfReview(ctx);
    case 'FASHION_WARDROBE_LIST':
      return handleWardrobeList(ctx);
    case 'FASHION_GARMENT_DETAIL':
      return handleGarmentDetail(ctx);
    case 'FASHION_EDIT_GARMENT_SELECT':
      return handleEditSelect(ctx);
    case 'FASHION_EDIT_GARMENT_FIELD':
      return handleEditField(ctx);
    case 'FASHION_DELETE_CONFIRM':
      return handleDeleteConfirm(ctx);
    case 'FASHION_OUTFIT_RESULT':
      return handleOutfitResult(ctx);
    case 'FASHION_MY_OUTFITS_LIST':
      return handleMyOutfitsList(ctx);
    default:
      fashionSessionsRepo.setState(ctx.userId, 'FASHION_HOME', {});
      return { consumed: true, reply: HOME_MENU };
  }
}
