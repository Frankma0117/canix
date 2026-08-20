/**
 * Single source of truth for the bot's "what can you do" menu - two levels (main menu of
 * categories, then one detail screen per category) driven by the zero-token `/menu` raw command
 * in bot-manager.ts (mirrors the existing `/reset`/`/ayuda` pattern: plain string match, no AI
 * call). show-menu.tool.ts (the natural-language "qué puedes hacer" trigger) renders the SAME
 * main menu from here instead of keeping its own separate copy, so the two entry points never
 * drift out of sync.
 */

export interface MenuCategory {
  key: string;
  /** Fixed 1-9 for the always-visible categories; undefined for gated ones (fashion/admin) shown
   *  by name only - a numbered position that shifts per-user (admin vs not) would be confusing. */
  number?: number;
  emoji: string;
  title: string;
  /** Words accepted after "/menu " (already lowercased/trimmed before matching). */
  aliases: string[];
  detail: string;
}

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const NAV_FOOTER = '\n\n↩️ /menu - volver al menú principal';

/** Which categories can be entered as a special mode (see agent/modes.ts) - recordatorios stays
 *  the only one active by default, and links/panel are never gated (links always auto-detected,
 *  panel is a tiny always-on utility). Declared here (not in modes.ts) so this file can flag them
 *  in the menu below without an import cycle - modes.ts imports THIS constant, not the reverse.
 *  'stickers' lives outside CORE_CATEGORIES (see STICKERS_CATEGORY below, admin-gated like fashion/
 *  admin) but is still a real mode key - modes.ts merges the two when resolving mode entry. */
export const MODE_KEYS = ['rutinas', 'tareas', 'notas', 'contactos', 'comidas', 'premios', 'resumenes', 'stickers'] as const;

/** Also the source of truth for which categories can become a special mode (see agent/modes.ts) -
 *  reuses these same keys/aliases/detail text so the /menu screen and the mode-entry command never
 *  drift apart. */
export const CORE_CATEGORIES: MenuCategory[] = [
  {
    key: 'recordatorios',
    number: 1,
    emoji: '⏰',
    title: 'Recordatorios',
    aliases: ['recordatorio', 'recordatorios', 'reminder', 'reminders'],
    detail:
      `⏰ *Recordatorios*\n\n` +
      `- Puntual: "recuérdame pagar el arriendo el viernes a las 8am"\n` +
      `- Fecha importante (cumpleaños, aniversarios, con aviso previo): "no dejes que se me olvide el cumpleaños de Ana el 20 de marzo"\n` +
      `- Flexible sin hora fija: "recuérdame estirar entre 3 y 5pm todos los días"\n` +
      `- Repetido cada cierto tiempo (timer): "avísame cada 30 segundos, 5 veces, para cambiar de serie"\n` +
      `- Editar, cancelar o borrar cualquiera\n` +
      `- Pausar uno por unos días sin perderlo\n` +
      `- "pausa todo por 5 días" silencia TODAS las notificaciones (recordatorios, rutinas, resúmenes) y vuelve solo - o "reanuda" cuando quieras`,
  },
  {
    key: 'rutinas',
    number: 2,
    emoji: '🔁',
    title: 'Rutinas y hábitos',
    aliases: ['rutina', 'rutinas', 'habito', 'habitos', 'hábito', 'hábitos', 'ejercicio', 'ejercicios'],
    detail:
      `🔁 *Rutinas y hábitos*\n\n` +
      `- Crear con hora de aviso + duración: "crea rutina de ejercicio a las 7am, 30 minutos"\n` +
      `- Marcar cumplida o no cumplida cada día, ver racha e historial\n` +
      `- Editar horario/frecuencia sin perder la racha\n` +
      `- Pausar unos días (vacaciones, lesión) sin borrarla\n` +
      `- Desglosar una rutina en ejercicios concretos (series/repeticiones/peso)`,
  },
  {
    key: 'tareas',
    number: 3,
    emoji: '✅',
    title: 'Tareas',
    aliases: ['tarea', 'tareas', 'todo', 'todos', 'pendientes'],
    detail:
      `✅ *Tareas*\n\n` +
      `- Agregar para hoy o para después\n` +
      `- Editar, marcar como hecha, eliminar\n` +
      `- Ver tu lista de pendientes`,
  },
  {
    key: 'notas',
    number: 4,
    emoji: '📝',
    title: 'Notas importantes',
    aliases: ['nota', 'notas'],
    detail:
      `📝 *Notas importantes*\n\n` +
      `- Guardar info suelta para consultar después: "anota que...", "guarda esta nota" (sin fecha ni hora - para eso son los recordatorios/tareas)\n` +
      `- Buscarlas por categoría o por texto\n` +
      `- Editar o eliminar`,
  },
  {
    key: 'links',
    number: 5,
    emoji: '🔗',
    title: 'Links',
    aliases: ['link', 'links', 'enlace', 'enlaces'],
    detail:
      `🔗 *Links*\n\n` +
      `- Guardar por categoría\n` +
      `- Buscar, o pedir uno al azar de una categoría\n` +
      `- Editar o eliminar\n` +
      `- Crear y gestionar tus propias categorías`,
  },
  {
    key: 'contactos',
    number: 6,
    emoji: '👤',
    title: 'Contactos',
    aliases: ['contacto', 'contactos'],
    detail:
      `👤 *Contactos*\n\n` +
      `- Guardar nombre + número (y @usuario de WhatsApp como referencia)\n` +
      `- Editar o eliminar\n` +
      `- Mandar mensajes por vos a quien pidas: "dile a Juan que ya voy"`,
  },
  {
    key: 'comidas',
    number: 7,
    emoji: '🍽️',
    title: 'Comidas y recetas',
    aliases: ['comida', 'comidas', 'receta', 'recetas'],
    detail:
      `🍽️ *Comidas y recetas*\n\n` +
      `- Planear qué comer por fecha y tipo de comida (desayuno/almuerzo/cena)\n` +
      `- Editar el plan\n` +
      `- Guardar y consultar tus recetas\n` +
      `- Pedir una sugerencia según ingredientes que tengas`,
  },
  {
    key: 'premios',
    number: 8,
    emoji: '🏆',
    title: 'Premios y castigos',
    aliases: ['premio', 'premios', 'castigo', 'castigos'],
    detail:
      `🏆 *Premios y castigos*\n\n` +
      `- Registrar los que te pongas, ligados a tus hábitos/rutinas\n` +
      `- Consultar el historial`,
  },
  {
    key: 'resumenes',
    number: 9,
    emoji: '📊',
    title: 'Resúmenes automáticos',
    aliases: ['resumen', 'resumenes', 'resúmenes', 'reporte', 'reportes'],
    detail:
      `📊 *Resúmenes automáticos*\n\n` +
      `- Agenda del día, cada mañana\n` +
      `- Reporte semanal, cada semana\n` +
      `- Pedilos cuando quieras: "cómo va mi día", "cómo me fue esta semana"`,
  },
  {
    key: 'panel',
    number: 10,
    emoji: '🌐',
    title: 'Panel web',
    aliases: ['panel', 'web'],
    detail:
      `🌐 *Panel web*\n\n` +
      `- Tu propio panel con tu token personal\n` +
      `- Si perdiste el token, pedime que te lo reenvíe`,
  },
];

const FASHION_CATEGORY: MenuCategory = {
  key: 'fashion',
  emoji: '👔',
  title: 'Fashion Mode',
  aliases: ['fashion', 'moda', 'armario', 'outfit', 'outfits'],
  detail:
    `👔 *Fashion Mode (armario y outfits)*\n\n` +
    `- Escribe "fashion", "moda", "outfit" o "armario" para entrar\n` +
    `- Agregá prendas mandando una foto - las clasifica automáticamente (o te pregunta si no puede)\n` +
    `- Mandá un PDF con varias fotos para agregarlas todas de una\n` +
    `- Consultá tu armario con filtros: "armario camisas", "armario favoritos"\n` +
    `- Editá, marcá favorito o eliminá cualquier prenda\n` +
    `- Pedí un outfit por ocasión: "outfit boda", "outfit oficina"\n` +
    `- Escribe "salir" para volver al chat normal`,
};

/**
 * Global sticker pack (see db/repositories/stickers.repo.ts, agent/tools/send-sticker.tool.ts) -
 * shown/enterable only for the admin (uploading and managing is admin-only), but every user's
 * conversation benefits: the AI agent picks WHEN to send one from any user's chat on its own
 * (never asked to), and the daily agenda push tries a "buenos días" sticker for every user, not
 * just the admin. Entering this mode only restricts which STICKER-MANAGEMENT tools (list/delete)
 * the agent can call - send_sticker itself stays in ALWAYS_ON_TOOLS so it keeps working from any
 * mode, for any user, exactly like links.
 */
export const STICKERS_CATEGORY: MenuCategory = {
  key: 'stickers',
  emoji: '🏷️',
  title: 'Stickers (admin)',
  aliases: ['sticker', 'stickers'],
  detail:
    `🏷️ *Stickers (solo administrador)*\n\n` +
    `- Mándame un sticker directo por WhatsApp para agregarlo - te pregunto con qué etiqueta guardarlo\n` +
    `- "lista" para ver los guardados, "borra <etiqueta>" para eliminar uno\n` +
    `- Son globales: el bot los usa por su cuenta en la conversación de CUALQUIER usuario, cuando el ` +
    `momento calce (saludo, celebración, motivación) - nadie tiene que pedirlo\n` +
    `- Escribe "salir" para volver a modo recordatorios`,
};

const ADMIN_CATEGORY: MenuCategory = {
  key: 'admin',
  emoji: '🛠️',
  title: 'Solo administrador',
  aliases: ['admin', 'administrador', 'administracion', 'administración'],
  detail:
    `🛠️ *Solo administrador*\n\n` +
    `- Dar o quitar acceso a otras personas\n` +
    `- Ver quién tiene acceso\n` +
    `- Limitar a alguien a solo ciertas funciones\n` +
    `- Ver y actuar sobre los datos de cualquier otra persona con acceso (pasando su nombre/número)\n` +
    `- Regenerar el token del panel de cualquiera`,
};

export interface MenuAccess {
  fashionEnabled: boolean;
  isAdmin: boolean;
}

function visibleCategories(access: MenuAccess): MenuCategory[] {
  const extra: MenuCategory[] = [];
  if (access.fashionEnabled) extra.push(FASHION_CATEGORY);
  if (access.isAdmin) extra.push(STICKERS_CATEGORY, ADMIN_CATEGORY);
  return [...CORE_CATEGORIES, ...extra];
}

function isModeCategory(key: string): boolean {
  return (MODE_KEYS as readonly string[]).includes(key);
}

export function renderMainMenu(access: MenuAccess): string {
  const lines: string[] = ['📋 *Menú Cania*', '', 'Elegí una categoría (número o nombre):', ''];

  for (const cat of CORE_CATEGORIES) {
    const modeHint = isModeCategory(cat.key) ? ` - escribe "${cat.aliases[0]}" para entrar` : '';
    lines.push(`${NUMBER_EMOJI[(cat.number ?? 1) - 1]} ${cat.emoji} ${cat.title}${modeHint}`);
  }
  if (access.fashionEnabled) lines.push(`${FASHION_CATEGORY.emoji} ${FASHION_CATEGORY.title} → /menu fashion`);
  if (access.isAdmin) {
    lines.push(`${STICKERS_CATEGORY.emoji} ${STICKERS_CATEGORY.title} → /menu stickers`);
    lines.push(`${ADMIN_CATEGORY.emoji} ${ADMIN_CATEGORY.title} → /menu admin`);
  }

  lines.push(
    '',
    '👉 /menu <número o nombre> - ej. "/menu 1" o "/menu recordatorios"',
    '👉 Recordatorios y links siempre están activos - las demás son modos: escribe su nombre para ' +
      'entrar, y "salir" para volver',
    '👉 /reset - borra el historial de este chat',
    '👉 /reset todo - borra TODA tu información',
    '',
    'O simplemente pedime lo que necesites hablando normal, como ya hacés. 🙌',
  );

  return lines.join('\n');
}

/** Resolves the text typed after "/menu " (already trimmed) to a category, matching a 1-9 number
 *  or any alias. Returns null when nothing matches - caller falls back to the main menu. */
export function resolveMenuCategory(input: string, access: MenuAccess): MenuCategory | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const asNumber = Number(text);
  if (Number.isInteger(asNumber)) {
    const byNumber = CORE_CATEGORIES.find((c) => c.number === asNumber);
    if (byNumber) return byNumber;
  }

  return visibleCategories(access).find((c) => c.aliases.includes(text)) ?? null;
}

export function renderCategoryDetail(category: MenuCategory): string {
  return category.detail + NAV_FOOTER;
}

export function renderUnknownCategory(access: MenuAccess): string {
  return `🤔 No encontré esa categoría.\n\n${renderMainMenu(access)}`;
}
