/**
 * Special modes (rutinas, tareas, notas, contactos, comidas, premios, resúmenes, stickers) - each
 * entered with a raw command exactly like Fashion Mode's "fashion"/"moda"/"outfit" (see
 * fashion/router.ts), except these stay on the normal AI tool-calling loop (ai-agent.ts) instead
 * of a bespoke state machine: entering a mode just restricts which tools the model can call this
 * turn to that category (plus recordatorios/links, always on - see ALWAYS_ON_TOOLS) and shows that
 * category's own menu. Recordatorios is the only mode active by default (no entry command needed);
 * links are always auto-detected regardless of the active mode, same as a PDF always interrupts
 * Fashion Mode's state machine no matter what state it's in. Stickers is the one admin-gated mode
 * (see STICKERS_CATEGORY below) - entering it only affects sticker MANAGEMENT (list/delete);
 * actually SENDING one (send_sticker) is a global, always-on ability the agent uses on its own in
 * any user's conversation, in any mode, never gated behind this one.
 *
 * Reuses agent/menu.ts's CORE_CATEGORIES as the single source of truth for keys/aliases/detail
 * text, so `/menu <categoría>` and typing the mode's name directly never drift apart.
 */
import { usersRepo } from '../db/repositories/users.repo.js';
import { CORE_CATEGORIES, STICKERS_CATEGORY, AGENDA_CATEGORY, MODE_KEYS, categoryAllowed, type MenuCategory, styledBullets } from './menu.js';
import { PERMISSIONS } from '../permissions/catalog.js';
import { effectivePermissions, asBotUser } from '../permissions/engine.js';

export type ModeKey = (typeof MODE_KEYS)[number];

/** Every category that can become a mode - CORE_CATEGORIES (universal) plus STICKERS_CATEGORY
 *  (admin-gated, lives outside CORE_CATEGORIES so it isn't shown to everyone in /menu - see
 *  menu.ts's visibleCategories). Entry-matching itself doesn't check role: it's the sticker tools
 *  (list_stickers/delete_sticker) that reject a non-admin, same graceful pattern as every other
 *  admin-only tool in this codebase. */
const MODE_CATEGORIES: MenuCategory[] = [...CORE_CATEGORIES, STICKERS_CATEGORY, AGENDA_CATEGORY];

/** Tool names each mode unlocks, on top of ALWAYS_ON_TOOLS. Grouped to match exactly what each
 *  category's /menu detail text (menu.ts) promises it can do. */
const MODE_TOOLS: Record<ModeKey, string[]> = {
  rutinas: [
    'create_routine',
    'checkin_routine',
    'edit_routine',
    'delete_routine',
    'routine_progress',
    'move_routine_today',
    'pause_routine',
    'resume_routine',
    'add_exercise',
    'list_exercises',
    'edit_exercise',
    'delete_exercise',
  ],
  tareas: [
    'add_todo',
    'list_todos',
    'complete_todo',
    'delete_todo',
    'edit_todo',
    // Listas para ir marcando de a poco (juegos, películas, libros, compras) - viven en modo
    // "tareas" pero son su propia entidad, no un todo (ver checklists.repo.ts).
    'create_list',
    'edit_list',
    'add_list_item',
    'list_lists',
    'view_list',
    'check_list_item',
    'delete_list_item',
    'delete_list',
  ],
  notas: ['add_note', 'list_notes', 'edit_note', 'delete_note'],
  // send_message (the proactive USE of the contacts list - "dile a Juan que...") stays in
  // ALWAYS_ON_TOOLS below, same reasoning as send_sticker in `stickers` further down - only the
  // MANAGEMENT tools (add/list/edit/delete) live behind this mode. Sending a message shouldn't
  // require first typing "contactos" and leaving whatever mode you're actually in.
  contactos: ['add_contact', 'list_contacts', 'edit_contact', 'delete_contact'],
  comidas: ['plan_meal', 'list_meal_plan', 'delete_meal_plan', 'edit_meal_plan'],
  // Separado de "comidas" a pedido explícito del usuario (ver menu.ts's RECETAS category comment) -
  // mismas tools de siempre, solo agrupadas en su propio modo con entrada/salida propia.
  recetas: ['save_recipe', 'list_recipes', 'get_recipe', 'delete_recipe'],
  premios: ['register_reward_punishment', 'list_rewards_punishments', 'delete_reward_punishment'],
  resumenes: ['get_today_agenda', 'get_week_report'],
  // send_sticker (the proactive USE of a sticker) stays in ALWAYS_ON_TOOLS below - only the
  // MANAGEMENT tools (admin-only, enforced inside each tool's execute) live behind this mode.
  stickers: ['list_stickers', 'delete_sticker'],
  // Both sides of scheduling (professional + client) - the person's permissions narrow it down to
  // the half they actually have (see ai-agent.ts's combineAllowed).
  agenda: PERMISSIONS.filter((p) => p.key.startsWith('scheduling.')).flatMap((p) => p.tools),
};

/** Available no matter the active mode: recordatorios (the default mode itself), links/categories
 *  (always auto-detected, per the user's explicit choice), navigation, and admin/account utilities
 *  that were never part of the 7 categories above to begin with. */
export const ALWAYS_ON_TOOLS = [
  'schedule_reminder',
  'list_reminders',
  'cancel_reminder',
  'edit_reminder',
  'delete_reminder',
  'schedule_important_date',
  'schedule_flexible_reminder',
  'schedule_interval_reminder',
  'schedule_call_reminder',
  'list_call_reminders',
  'edit_call_reminder',
  'cancel_call_reminder',
  'delete_call_reminder',
  'pause_reminder',
  'resume_reminder',
  'pause_notifications',
  'resume_notifications',
  'create_category',
  'list_categories',
  'edit_category',
  'delete_category',
  'save_link',
  'list_links',
  'pick_link',
  'edit_link',
  'delete_link',
  'show_menu',
  'change_web_password',
  'grant_access',
  'revoke_access',
  'list_users',
  'set_user_permissions',
  'list_permissions',
  'get_user_permissions',
  'manage_permission_package',
  'set_web_password',
  'manage_scheduling_group',
  'send_sticker',
  'send_message',
  'announce_update',
  'set_user_gender',
  'set_voice_gender',
  'choose_voice',
  'set_fashion_profile',
];

const EXIT_KEYWORDS = ['salir', 'salir modo', 'recordatorios', 'modo recordatorios'];

export function isModeKey(key: string | null | undefined): key is ModeKey {
  return !!key && (MODE_KEYS as readonly string[]).includes(key);
}

/** The full category (title, emoji, detail text) behind a mode key - used both to render its entry
 *  menu here and to build the AI system-prompt addendum in ai-agent.ts. */
export function getModeCategory(key: ModeKey): MenuCategory {
  return MODE_CATEGORIES.find((c) => c.key === key)!;
}

/** Matches a raw incoming message (already trimmed/lowercased) against a mode's entry vocabulary -
 *  whole-string match only (same discipline as fashion/router.ts's matchFashionEntry), so an
 *  ordinary sentence that happens to mention "tareas" mid-phrase never accidentally switches mode. */
function resolveModeEntry(textLower: string): MenuCategory | null {
  const withoutPrefix = textLower.startsWith('modo ') ? textLower.slice('modo '.length).trim() : textLower;
  return MODE_CATEGORIES.find((c) => isModeKey(c.key) && c.aliases.includes(withoutPrefix)) ?? null;
}

/**
 * Tool names the AI agent may call this turn: no longer narrowed by the section that's open. A
 * mode used to lock the conversation to its own tools, so asking for anything else got "eso es de
 * otra categoría, escribe salir" - friction the user asked to remove. Opening a section now only
 * shows what can be done there; everything the person is allowed to use works from anywhere.
 * (Kept as a function so callers don't change if a narrowing is ever wanted again.)
 */
export function toolsForMode(_key: ModeKey | null): string[] | null {
  return null;
}

/**
 * Entry screen for a mode: its title and what can be asked for there, built from category.detail's
 * own bullets (never a separate copy) so it can't drift from what `/menu <categoría>` answers. The
 * mode runs on the normal AI loop, so the bullets are examples to talk from, not options to pick.
 */
export function renderModeEntryMessage(category: MenuCategory): string {
  const lines = category.detail.split('\n');
  const header = lines[0]; // "🔁 *Rutinas y hábitos*"
  // Drops any bullet that's itself just the "escribe salir para..." instruction (see
  // STICKERS_CATEGORY) - this menu already appends its own "🚪 Salir" option + footer sentence for
  // every category, so keeping that bullet too would just repeat the same instruction twice.
  const usable = lines.filter((l) => l.trim().startsWith('- ') && !/\bsalir\b/i.test(l)).join('\n');
  return [header, 'Ya estás aquí. Pídeme lo que necesites, por ejemplo:', '', ...styledBullets(usable), '', '> Puedes pedirme cualquier otra cosa desde aquí, sin salir'].join('\n');
}

export function renderModeExitMessage(): string {
  return '👋 Listo, volviste al inicio.\n\n> Escribe */menu* para ver todo lo que puedo hacer';
}

export interface ModeRouterResult {
  consumed: boolean;
  reply?: string;
}

/**
 * Zero-token raw-command routing for mode entry/exit - called from bot-manager.ts BEFORE the AI
 * loop, after Fashion Mode (which is a fully separate, self-contained island - see fashion/router.ts)
 * has had a chance to consume the message. Returns `consumed: false` for anything that isn't a mode
 * command, letting bot-manager.ts fall through to the normal AI loop, which reads the user's
 * (possibly just-changed) active_mode itself via toolsForMode() - see ai-agent.ts.
 */
export function handleModeMessage(userId: number, text: string): ModeRouterResult {
  const textLower = text.trim().toLowerCase();
  if (!textLower) return { consumed: false };

  const storedUser = usersRepo.getById(userId);
  const user = storedUser && asBotUser(storedUser);
  const currentMode = isModeKey(user?.active_mode) ? user!.active_mode : null;

  if (EXIT_KEYWORDS.includes(textLower)) {
    if (!currentMode) return { consumed: false }; // already default - let the AI handle a bare "salir"
    // Leaving a section is just closing its screen - the conversation carries on as it was.
    usersRepo.setActiveMode(userId, null);
    console.log('[MODE] Usuario #%d cerró la sección %s.', userId, currentMode);
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
    usersRepo.setActiveMode(userId, category.key as ModeKey);
    console.log('[MODE] Usuario #%d abrió la sección %s.', userId, category.key);
  }
  return { consumed: true, reply: renderModeEntryMessage(category) };
}
