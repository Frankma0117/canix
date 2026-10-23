/**
 * Sections (routines, to-dos, notes, contacts, meals, rewards, summaries, stickers) - each opened
 * with a plain command, like Fashion Mode's "fashion"/"moda"/"outfit" (see
 * services/fashion/fashion.router.ts), except these stay on the normal AI tool-calling loop
 * (agent/agent.ts) instead of a dedicated state machine. Opening a section only shows what can be
 * done there and tells the prompt which area the person is in - it never narrows which tools can
 * be called (everything the person is allowed to use works from anywhere). Stickers is the one
 * admin-only section: it covers sticker MANAGEMENT (list/delete); SENDING one (send_sticker) is an
 * always-on ability the agent uses on its own in any conversation.
 *
 * Reuses agent/menu.ts's CORE_CATEGORIES as the single source of truth for keys/aliases/detail
 * text, so `/menu <section>` and typing the section's name directly never drift apart.
 */
import { usersModel } from '../models/users.model.js';
import { CORE_CATEGORIES, STICKERS_CATEGORY, AGENDA_CATEGORY, MODE_KEYS, categoryAllowed, type MenuCategory, styledBullets } from './menu.js';
import { effectivePermissions, asBotUser } from '../services/permissions/permissions.service.js';

export type ModeKey = (typeof MODE_KEYS)[number];

/** Every category that can become a mode - CORE_CATEGORIES (universal) plus STICKERS_CATEGORY
 *  (admin-gated, lives outside CORE_CATEGORIES so it isn't shown to everyone in /menu - see
 *  menu.ts's visibleCategories). Entry-matching itself doesn't check role: it's the sticker tools
 *  (list_stickers/delete_sticker) that reject a non-admin, same graceful pattern as every other
 *  admin-only tool in this codebase. */
const MODE_CATEGORIES: MenuCategory[] = [...CORE_CATEGORIES, STICKERS_CATEGORY, AGENDA_CATEGORY];

const EXIT_KEYWORDS = ['salir', 'salir modo', 'recordatorios', 'modo recordatorios'];

export function isModeKey(key: string | null | undefined): key is ModeKey {
  return !!key && (MODE_KEYS as readonly string[]).includes(key);
}

/** The full category (title, emoji, detail text) behind a mode key - used both to render its entry
 *  menu here and to build the AI system-prompt addendum in agent.ts. */
export function getModeCategory(key: ModeKey): MenuCategory {
  return MODE_CATEGORIES.find((c) => c.key === key)!;
}

/** Matches a raw incoming message (already trimmed/lowercased) against a mode's entry vocabulary -
 *  whole-string match only (same discipline as services/fashion/fashion.router.ts's matchFashionEntry), so an
 *  ordinary sentence that happens to mention "tareas" mid-phrase never accidentally switches mode. */
function resolveModeEntry(textLower: string): MenuCategory | null {
  const withoutPrefix = textLower.startsWith('modo ') ? textLower.slice('modo '.length).trim() : textLower;
  return MODE_CATEGORIES.find((c) => isModeKey(c.key) && c.aliases.includes(withoutPrefix)) ?? null;
}

/**
 * Entry screen for a mode: its title and what can be asked for there, built from category.detail's
 * own bullets (never a separate copy) so it can't drift from what `/menu <categoría>` answers. The
 * mode runs on the normal AI loop, so the bullets are examples to talk from, not options to pick.
 */
function renderModeEntryMessage(category: MenuCategory): string {
  const lines = category.detail.split('\n');
  const header = lines[0]; // "🔁 *Rutinas y hábitos*"
  // Drops any bullet that's itself just the "escribe salir para..." instruction (see
  // STICKERS_CATEGORY) - this menu already appends its own "🚪 Salir" option + footer sentence for
  // every category, so keeping that bullet too would just repeat the same instruction twice.
  const usable = lines.filter((l) => l.trim().startsWith('- ') && !/\bsalir\b/i.test(l)).join('\n');
  return [header, 'Ya estás aquí. Pídeme lo que necesites, por ejemplo:', '', ...styledBullets(usable), '', '> Puedes pedirme cualquier otra cosa desde aquí, sin salir'].join('\n');
}

function renderModeExitMessage(): string {
  return '👋 Listo, volviste al inicio.\n\n> Escribe */menu* para ver todo lo que puedo hacer';
}

export interface ModeRouterResult {
  consumed: boolean;
  reply?: string;
}

/**
 * Zero-token raw-command routing for mode entry/exit - called from bot-manager.ts BEFORE the AI
 * loop, after Fashion Mode (which is a fully separate, self-contained island - see services/fashion/fashion.router.ts)
 * has had a chance to consume the message. Returns `consumed: false` for anything that isn't a mode
 * command, letting bot-manager.ts fall through to the normal AI loop, which reads the user's
 * (possibly just-changed) active_mode itself via toolsForMode() - see agent.ts.
 */
export function handleModeMessage(userId: number, text: string): ModeRouterResult {
  const textLower = text.trim().toLowerCase();
  if (!textLower) return { consumed: false };

  const storedUser = usersModel.getById(userId);
  const user = storedUser && asBotUser(storedUser);
  const currentMode = isModeKey(user?.active_mode) ? user!.active_mode : null;

  if (EXIT_KEYWORDS.includes(textLower)) {
    if (!currentMode) return { consumed: false }; // already default - let the AI handle a bare "salir"
    // Leaving a section is just closing its screen - the conversation carries on as it was.
    usersModel.setActiveMode(userId, null);
    console.log('[MODE] User #%d closed section %s.', userId, currentMode);
    return { consumed: true, reply: renderModeExitMessage() };
  }

  const category = resolveModeEntry(textLower);
  if (!category) return { consumed: false };

  // Entering a mode the administrator hasn't enabled for this person: say so, don't switch.
  if (user && !categoryAllowed(category.key, { isAdmin: user.role === 'admin', permissions: effectivePermissions(user) })) {
    return {
      consumed: true,
      reply: `🔒 *${category.title}* no está habilitado para ti. Si lo necesitas, pídeselo al administrador. Escribe /menu para ver lo que sí tienes.`,
    };
  }

  if (category.key !== currentMode) {
    usersModel.setActiveMode(userId, category.key as ModeKey);
    console.log('[MODE] User #%d opened section %s.', userId, category.key);
  }
  return { consumed: true, reply: renderModeEntryMessage(category) };
}
