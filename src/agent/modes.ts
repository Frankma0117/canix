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
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { CORE_CATEGORIES, STICKERS_CATEGORY, AGENDA_CATEGORY, MODE_KEYS, categoryAllowed, type MenuCategory } from './menu.js';
import { PERMISSIONS } from '../permissions/catalog.js';
import { effectivePermissions } from '../permissions/engine.js';

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

/** Tool names the AI agent may call this turn - null means "no extra restriction" (only the
 *  existing per-user allowed_tools permission, if any, still applies). */
export function toolsForMode(key: ModeKey | null): string[] | null {
  if (!key) return null;
  return [...ALWAYS_ON_TOOLS, ...MODE_TOOLS[key]];
}

const ENTRY_NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/**
 * Entry screen for a mode - same numbered "¿qué querés hacer?" shape as Fashion Mode's own HOME_MENU
 * (see fashion/flows/home.flow.ts), instead of just dumping the category's bullet list as prose.
 * Built from category.detail's own bullets (never a separate copy) so this can never drift from
 * `/menu <categoría>`'s answer - just re-numbered instead of dashed, plus a closing "Salir" option.
 * The numbers are illustrative, not a strict tap-to-select menu like Fashion's: this mode still runs
 * on the normal AI loop (see this file's own top comment), so typing natural language works exactly
 * the same as before - the numbering is purely to make "what can I do here" scannable at a glance.
 */
export function renderModeEntryMessage(category: MenuCategory): string {
  const lines = category.detail.split('\n');
  const header = lines[0]; // "🔁 *Rutinas y hábitos*"
  // Drops any bullet that's itself just the "escribe salir para..." instruction (see
  // STICKERS_CATEGORY) - this menu already appends its own "🚪 Salir" option + footer sentence for
  // every category, so keeping that bullet too would just repeat the same instruction twice.
  const bullets = lines
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => l.trim().slice(2))
    .filter((b) => !/\bsalir\b/i.test(b));
  const options = bullets.map((b, i) => `${ENTRY_NUMBER_EMOJI[i] ?? `${i + 1}.`} ${b}`).join('\n');

  return (
    `${header}\n\n` +
    `¿Qué quieres hacer?\n\n` +
    `${options}\n` +
    `🚪 Salir\n\n` +
    `Ya estás en modo *${category.title}* - no hace falta escribir un número, hablame normal y ya. ` +
    `Escribe "salir" para volver a modo recordatorios, o el nombre de otro modo para cambiar directo.`
  );
}

export function renderModeExitMessage(): string {
  return '👋 Volviste a modo *Recordatorios* (el de siempre) - los links siguen funcionando siempre, sin importar el modo.';
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

  const user = usersRepo.getById(userId);
  const currentMode = isModeKey(user?.active_mode) ? user!.active_mode : null;

  if (EXIT_KEYWORDS.includes(textLower)) {
    if (!currentMode) return { consumed: false }; // already default - let the AI handle a bare "salir"
    usersRepo.setActiveMode(userId, null);
    // Wipes the chat history along with the mode switch - without this, the AI's next reply (back
    // in normal mode) still carried the whole conversation from inside the mode just left (or from
    // whatever was being discussed right before entering it), and kept answering as if that were
    // still the topic ("me empieza a responder con otras cosas" - see the user's own report). A
    // mode switch is a hard context boundary, so the chat history resets with it, same as /reset.
    messagesRepo.clear(userId);
    console.log('[MODE] Usuario #%d volvió a modo recordatorios (historial reiniciado).', userId);
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
    messagesRepo.clear(userId); // see the exit branch above for why
    console.log('[MODE] Usuario #%d entró a modo %s (historial reiniciado).', userId, category.key);
  }
  return { consumed: true, reply: renderModeEntryMessage(category) };
}
