/**
 * Single source of truth for the bot's "what can you do" menu - two levels (main menu of
 * categories, then one detail screen per category) driven by the zero-token `/menu` raw command
 * in bot-manager.ts (mirrors the existing `/reset`/`/ayuda` pattern: plain string match, no AI
 * call). show-menu.tool.ts (the natural-language "qué puedes hacer" trigger) renders the SAME
 * main menu from here instead of keeping its own separate copy, so the two entry points never
 * drift out of sync.
 */

import { keycap } from '../shared/utils/wa-format.js';

export interface MenuCategory {
  key: string;
  /** Fixed 1-9 for the always-visible categories; undefined for gated ones (fashion/admin) shown
   *  by name only - a numbered position that shifts per-user (admin vs not) would be confusing. */
  number?: number;
  emoji: string;
  title: string;
  /** One-line description shown directly on the main menu screen, right under the title - so the
   *  menu itself explains what each category is for instead of just naming it and making the user
   *  drill into "/menu <categoría>" to find out. Keep it under ~90 chars. */
  short: string;
  /** Words accepted after "/menu " (already lowercased/trimmed before matching). */
  aliases: string[];
  detail: string;
}


const NAV_FOOTER = '\n\n> */menu* vuelve al menú principal';

/** Which categories can be entered as a special mode (see agent/modes.ts) - recordatorios stays
 *  the only one active by default, and links/panel are never gated (links always auto-detected,
 *  panel is a tiny always-on utility). Declared here (not in modes.ts) so this file can flag them
 *  in the menu below without an import cycle - modes.ts imports THIS constant, not the reverse.
 *  'stickers' lives outside CORE_CATEGORIES (see STICKERS_CATEGORY below, admin-gated like fashion/
 *  admin) but is still a real mode key - modes.ts merges the two when resolving mode entry. */
export const MODE_KEYS = ['rutinas', 'ejercicios', 'medicamentos', 'tareas', 'notas', 'contactos', 'comidas', 'recetas', 'premios', 'resumenes', 'stickers', 'agenda'] as const;

/**
 * Which permission(s) make each category visible/enterable (see services/permissions/catalog.ts) - any one
 * of the listed keys is enough. 'stickers'/'admin' are admin-only (checked separately).
 */
const CATEGORY_PERMISSIONS: Record<string, string[]> = {
  recordatorios: ['reminders.manage'],
  medicamentos: ['medications.manage'],
  categorias: ['links.manage', 'notes.manage', 'reminders.manage', 'todos.manage', 'recipes.manage'],
  rutinas: ['routines.manage'],
  ejercicios: ['workouts.manage'],
  tareas: ['todos.manage'],
  notas: ['notes.manage'],
  links: ['links.manage'],
  contactos: ['contacts.manage', 'messages.send'],
  comidas: ['meals.manage'],
  recetas: ['recipes.manage'],
  premios: ['rewards.manage'],
  resumenes: ['summaries.view'],
  panel: ['portal.access'],
  llamadas: ['reminders.calls'],
  fashion: ['fashion.use'],
  agenda: ['scheduling.professional', 'scheduling.client'],
};

/** True when this person may see/enter the category (admins: always). */
export function categoryAllowed(key: string, access: Pick<MenuAccess, 'isAdmin' | 'permissions'>): boolean {
  if (access.isAdmin) return true;
  if (key === 'stickers' || key === 'admin') return false;
  const needed = CATEGORY_PERMISSIONS[key];
  return !needed || needed.some((p) => access.permissions.has(p));
}

/** Also the source of truth for which categories can become a special mode (see agent/modes.ts) -
 *  reuses these same keys/aliases/detail text so the /menu screen and the mode-entry command never
 *  drift apart. */
export const CORE_CATEGORIES: MenuCategory[] = [
  {
    key: 'recordatorios',
    number: 1,
    emoji: '⏰',
    title: 'Recordatorios',
    short: 'Avisos puntuales, fechas importantes, sin hora fija o repetidos - y por llamada si es urgente.',
    aliases: ['recordatorio', 'recordatorios', 'reminder', 'reminders'],
    detail:
      `⏰ *Recordatorios*\n\n` +
      `- Puntual: "recuérdame pagar el arriendo el viernes a las 8am"\n` +
      `- Fecha importante (cumpleaños, aniversarios, con aviso previo): "no dejes que se me olvide el cumpleaños de Ana el 20 de marzo"\n` +
      `- Flexible sin hora fija: "recuérdame estirar entre 3 y 5pm todos los días"\n` +
      `- Repetido cada cierto tiempo (timer): "avísame cada 30 segundos, 5 veces, para cambiar de serie"\n` +
      `- Editar, cancelar o borrar cualquiera\n` +
      `- Pausar uno por unos días sin perderlo\n` +
      `- "pausa todo por 5 días" silencia TODAS las notificaciones (recordatorios, rutinas, resúmenes) y vuelve solo - o "reanuda" cuando quieras\n` +
      `- Sin hora: "recuérdame llamar al banco en algún momento" - lo pongo en un espacio libre de tu día y te digo a qué hora`,
  },
  {
    key: 'medicamentos',
    emoji: '💊',
    title: 'Medicamentos y belleza',
    short: 'Pastillas, vitaminas, cremas, skincare, tomar agua, faja y cuidado corporal: a su hora y que no se te pasen.',
    aliases: ['medicamentos', 'medicamento', 'medicinas', 'pastillas', 'belleza', 'skincare', 'agua', 'tomar agua', 'hidratacion', 'hidratación', 'faja', 'cuidado corporal', 'cuidado personal'],
    detail:
      `💊 *Medicamentos y belleza*\n\n` +
      `- A hora fija: "la pastilla de la tensión todos los días a las 8am, 1 tableta con el desayuno"\n` +
      `- Cada tantas horas: "el antibiótico cada 8 horas por 7 días, empezando a las 6am"\n` +
      `- Belleza y cuidado personal: "crema de noche todos los días a las 10pm", "mascarilla los domingos a las 7pm"\n` +
      `- Cuidado corporal: "recuérdame ponerme la faja a las 7am y quitármela a las 7pm", "las medias de compresión cada mañana"\n` +
      `- Tomar agua: "recuérdame tomar agua cada 2 horas de 8am a 8pm" - cada 👍 al aviso (o "ya me tomé un vaso") suma a tu meta del día\n` +
      `- A cada hora te aviso "toca tomar…": confírmalo reaccionando 👍/👎 al aviso, o dime "ya me la tomé"\n` +
      `- "qué medicamentos tengo" te muestra horas, dosis y cómo vas esta semana; también en el portal\n` +
      `- Pausar o cambiar: "pausa la crema", "la vitamina ahora a las 9"`,
  },
  {
    key: 'rutinas',
    number: 2,
    emoji: '🔁',
    title: 'Rutinas y hábitos',
    short: 'Hábitos con hora fija, racha e historial - márcalos cumplidos o no cada día.',
    aliases: ['rutina', 'rutinas', 'habito', 'habitos', 'hábito', 'hábitos'],
    detail:
      `🔁 *Rutinas y hábitos*\n\n` +
      `- Crear con hora de aviso + duración: "crea rutina de leer a las 9pm, 20 minutos"\n` +
      `- Elegir cada cuánto: todos los días, "lunes y jueves", "cada 15 días", "cada mes el 5"\n` +
      `- Marcar cumplida o no reaccionando 👍/👎 al aviso; ver racha e historial\n` +
      `- Editar horario/frecuencia sin perder la racha\n` +
      `- Pausar unos días (vacaciones, viaje) sin borrarla\n` +
      `- El ejercicio (boxeo, zumba, gym...) tiene su propia sección: escribe *ejercicios*`,
  },
  {
    key: 'ejercicios',
    emoji: '🏋️',
    title: 'Ejercicios',
    short: 'Boxeo, zumba, gym, correr, yoga y cualquier deporte: aviso a la hora, sesiones de la semana y racha.',
    aliases: ['ejercicio', 'ejercicios', 'entrenamiento', 'entrenamientos', 'entrenar', 'deporte', 'deportes', 'gym', 'gimnasio', 'workout', 'actividad fisica', 'actividad física'],
    detail:
      `🏋️ *Ejercicios*\n\n` +
      `- Agregar con días, hora y duración: "boxeo los lunes y miércoles a las 7pm, 1 hora, en el gimnasio Body"\n` +
      `- Cualquier actividad: "zumba los sábados a las 9am", "correr todos los días a las 6am, 30 minutos", "yoga martes y jueves"\n` +
      `- A su hora te aviso; márcalo reaccionando 👍/👎 al aviso o dime "ya hice boxeo"\n` +
      `- "mis ejercicios" te muestra cómo vas: sesiones y minutos de la semana y tu racha; también en el portal\n` +
      `- Desglose para seguir en la clase: "agrégale a boxeo 3 rounds de 3 minutos de sombra" - sale en el aviso\n` +
      `- Solo por hoy a otra hora: "hoy el boxeo a las 8pm"\n` +
      `- Cambiar días u hora sin perder la racha, o pausarlo por lesión o viaje`,
  },
  {
    key: 'tareas',
    number: 3,
    emoji: '✅',
    title: 'Tareas',
    short: 'Pendientes para hoy o para después, y listas para ir marcando (juegos, películas, etc.).',
    aliases: ['tarea', 'tareas', 'todo', 'todos', 'pendientes'],
    detail:
      `✅ *Tareas*\n\n` +
      `- Agregar para hoy o para después\n` +
      `- Editar, marcar como hecha, eliminar\n` +
      `- Ver tu lista de pendientes\n` +
      `- Listas para ir marcando de a poco (distintas de una tarea suelta): "crea una lista de juegos de Mario que ` +
      `quiero", "agrega Super Mario Odyssey a esa lista", "marca Odyssey", "muéstrame la lista de películas por ver"
` +
      `- Biblioteca de películas, series, música y libros: mándame un link y dime "es una película sobre..." y queda en ` +
      `tus links y en tu lista de películas; luego pregúntame "¿qué película puedo ver?" y te digo cuáles no has visto`,
  },
  {
    key: 'notas',
    number: 4,
    emoji: '📝',
    title: 'Notas importantes',
    short: 'Tips clave para no olvidar: lo importante resumido en puntos cortos.',
    aliases: ['nota', 'notas', 'tip', 'tips'],
    detail:
      `📝 *Notas importantes*\n\n` +
      `- Guardar lo importante como tips clave: "anota que el carro necesita aceite 5W-30 y cambio cada 5.000 km" queda en puntos cortos\n` +
      `- Si hay algo que hacer "en algún momento", además te lo agendo en un espacio libre y te digo la hora\n` +
      `- Buscarlas por categoría o por texto\n` +
      `- Editar o eliminar`,
  },
  {
    key: 'links',
    number: 5,
    emoji: '🔗',
    title: 'Links',
    short: 'Guarda enlaces por categoría y pedí uno al azar cuando quieras.',
    aliases: ['link', 'links', 'enlace', 'enlaces'],
    detail:
      `🔗 *Links*\n\n` +
      `- Guardar por categoría\n` +
      `- Buscar, o pedir uno al azar de una categoría\n` +
      `- Editar o eliminar\n` +
      `- Cuando creas una rutina o pides una receta, te sugiero los links que ya tienes sobre eso`,
  },
  {
    key: 'categorias',
    emoji: '📁',
    title: 'Categorías',
    short: 'Generales: una misma categoría agrupa links, notas, recordatorios, tareas y recetas.',
    aliases: ['categoria', 'categorias', 'categoría', 'categorías'],
    detail:
      `📁 *Categorías*\n\n` +
      `- Son generales, no solo de links: "Salud" puede tener links, notas, recordatorios, tareas y recetas\n` +
      `- Ver cuánto tiene cada una: "qué categorías tengo"\n` +
      `- Crear, renombrar o borrar: "crea la categoría Viajes" (al borrarla, lo que tenía no se pierde)\n` +
      `- Guardar algo en una: "anota en Viajes que...", "recuérdame en Salud..."`,
  },
  {
    key: 'contactos',
    number: 6,
    emoji: '👤',
    title: 'Contactos',
    short: 'Guarda nombre + número y pídeme que mande mensajes por vos.',
    aliases: ['contacto', 'contactos'],
    detail:
      `👤 *Contactos*\n\n` +
      `- Guardar nombre + número (y @usuario de WhatsApp como referencia)\n` +
      `- Editar o eliminar\n` +
      `- Mandar mensajes por ti a quien pidas: "dile a Juan que ya voy"`,
  },
  {
    key: 'comidas',
    number: 7,
    emoji: '🍽️',
    title: 'Comidas',
    short: 'Ideas y plan de desayuno, onces, almuerzo, media tarde y cena.',
    aliases: ['comida', 'comidas'],
    detail:
      `🍽️ *Comidas*\n\n` +
      `- Ideas para todo el día: "qué como hoy" - desayuno, onces, almuerzo, media tarde y cena\n` +
      `- Con lo que tienes: "tengo huevos, arroz y tomate, ¿qué hago de almuerzo?"\n` +
      `- Cada idea queda guardada en tus recetas, con lo que ya tenías guardado sobre eso (recetas y links)\n` +
      `- Planear qué comer por fecha: "ponlas en mi plan de mañana"\n` +
      `- Editar el plan`,
  },
  // Split from "comidas" (they used to live together) at the user's explicit request - two different
  // things (planning what to eat on a given day vs. a recipe library to browse any time) that felt
  // mixed up in one section. Same tools (save_recipe/list_recipes/get_recipe/delete_recipe); only the
  // grouping changed.
  {
    key: 'recetas',
    number: 8,
    emoji: '📖',
    title: 'Recetas',
    short: 'Guarda tus recetas y pedí sugerencias según los ingredientes que tengas.',
    aliases: ['receta', 'recetas'],
    detail:
      `📖 *Recetas*\n\n` +
      `- Dime qué ingredientes tienes y te doy recetas: "tengo pollo, papa y cebolla"\n` +
      `- Las recetas que te sugiero quedan guardadas aquí solas\n` +
      `- Te muestro también las recetas y links de comida que ya tenías sobre eso\n` +
      `- Guardar las tuyas, consultarlas, editarlas o eliminarlas`,
  },
  {
    key: 'premios',
    number: 9,
    emoji: '🏆',
    title: 'Premios y castigos',
    short: 'Registra los que te pongas, ligados a tus hábitos y rutinas.',
    aliases: ['premio', 'premios', 'castigo', 'castigos'],
    detail:
      `🏆 *Premios y castigos*\n\n` +
      `- Registrar los que te pongas, ligados a tus hábitos/rutinas: "si cumplo el gym toda la semana me premio con pizza"\n` +
      `- Te los recuerdo: en tu agenda del día ves el premio en juego y cómo vas\n` +
      `- En el resumen semanal te digo si te ganaste el premio o te toca el castigo\n` +
      `- Consultar el historial`,
  },
  {
    key: 'resumenes',
    number: 10,
    emoji: '📊',
    title: 'Resúmenes automáticos',
    short: 'Agenda cada mañana y reporte semanal, o pedilos cuando quieras.',
    aliases: ['resumen', 'resumenes', 'resúmenes', 'reporte', 'reportes'],
    detail:
      `📊 *Resúmenes automáticos*\n\n` +
      `- Agenda del día, cada mañana\n` +
      `- Reporte semanal, cada semana\n` +
      `- Pedilos cuando quieras: "cómo va mi día", "cómo me fue esta semana"`,
  },
  {
    key: 'panel',
    number: 11,
    emoji: '🌐',
    title: 'Portal web',
    short: 'Entrá con tu número y contraseña - ves solo tus módulos habilitados.',
    aliases: ['panel', 'web', 'portal'],
    detail:
      `🌐 *Portal web*\n\n` +
      `- Entrás con tu número de WhatsApp y tu contraseña\n` +
      `- Ves y gestionas solo tus datos y los módulos que tienes habilitados\n` +
      `- ¿Primera vez u olvidaste la contraseña? Pídeme "cambia mi contraseña del portal" y te mando una temporal`,
  },
];

export const AGENDA_CATEGORY: MenuCategory = {
  key: 'agenda',
  emoji: '📅',
  title: 'Agenda y citas',
  short: 'Agenda citas con profesionales, o maneja tu propia agenda si eres profesional.',
  aliases: ['agenda', 'agendamiento', 'cita', 'citas', 'agendar'],
  detail:
    `📅 *Agenda y citas*\n\n` +
    `- Ver los espacios disponibles de tu profesional y pedir una cita: "qué horarios hay el jueves"\n` +
    `- Ver y cancelar tus citas: "cuáles son mis citas"\n` +
    `- Profesional: definir tu horario de atención, ver tu agenda, confirmar/rechazar/cancelar/programar citas\n` +
    `- Profesional: compartir acceso a un cliente para que agende: "dale acceso a agendar a 3001234567 Ana"\n` +
    `- Recordatorio automático el día de la cita (en la mañana, o como lo configure el profesional)\n` +
    `- Calendario completo en el portal web`,
};

const CALLS_CATEGORY: MenuCategory = {
  key: 'llamadas',
  emoji: '📞',
  title: 'Llamadas telefónicas',
  short: 'Te llama de verdad al teléfono para lo importante, o para despertarte con una alarma.',
  aliases: ['llamada', 'llamadas', 'llamar', 'call', 'calls'],
  detail:
    `📞 *Llamadas telefónicas*\n\n` +
    `- Para lo realmente importante: te llama de verdad al teléfono en vez de solo mandar un WhatsApp\n` +
    `- "llámame a las 8am para recordarme la reunión" - te llama y te DICE el mensaje en voz\n` +
    `- "despiértame a las 6am con una llamada" (alarma) - solo timbra y cuelga al contestar, sin decir nada\n` +
    `- Si marcás un recordatorio o fecha normal como importante/urgente (o suena así), te pregunto si además quieres que te llame - nunca llamo sin que lo confirmes\n` +
    `- Puede repetirse (diario/semanal/mensual/anual), igual que un recordatorio normal\n` +
    `- Editar, cancelar o eliminar cualquiera\n` +
    `- Administrador: puede pedir que llame a otra persona con acceso`,
};

const FASHION_CATEGORY: MenuCategory = {
  key: 'fashion',
  emoji: '👔',
  title: 'Fashion Mode',
  short: 'Armario digital por foto y sugerencias de outfit según la ocasión.',
  aliases: ['fashion', 'moda', 'armario', 'outfit', 'outfits'],
  detail:
    `👔 *Fashion Mode (armario y outfits)*\n\n` +
    `- Escribe "fashion", "moda", "outfit" o "armario" para entrar\n` +
    `- Agrega prendas mandando una foto - detecta tipo, categoría, color (principal y secundario), ` +
    `patrón, material, ajuste, estilo, formalidad y más, automáticamente\n` +
    `- Manda un PDF con varias fotos para agregarlas todas de una\n` +
    `- Consultá tu armario con filtros: "armario camisas", "armario favoritos"\n` +
    `- Editá, marcá favorito o eliminá cualquier prenda\n` +
    `- "actualizar ropa" vuelve a analizar TODAS tus prendas guardadas con el detector más reciente\n` +
    `- Cuéntame tu talla/contextura/altura y colores/estilos que preferís, para que el outfit se ` +
    `ajuste mejor a vos\n` +
    `- Pide un outfit por ocasión o con lo que quieras: "outfit boda", "un outfit con polo azul", ` +
    `"un outfit que no tenga camiseta blanca"\n` +
    `- Cada prenda del outfit te llega en foto: reacciona 👎 para cambiar solo esa, ❤️ para armar ` +
    `otro con esa, 🗑️ si ya no la tienes, 👍 para dejarla fija\n` +
    `- O dilo escrito: "cambia la camiseta", "deja solo el pantalón", "ya no tengo esos zapatos"\n` +
    `- Escribe "salir" para volver al chat normal`,
};

/**
 * Global sticker pack (see models/stickers.model.ts, agent/tools/stickers/send-sticker.tool.ts) -
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
  short: 'Mandale un sticker al bot para enseñárselo - lo usa por su cuenta cuando calza.',
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
  short: 'Gestiona el acceso y los datos de otras personas.',
  aliases: ['admin', 'administrador', 'administracion', 'administración'],
  detail:
    `🛠️ *Solo administrador*\n\n` +
    `- Dar o quitar acceso a otras personas\n` +
    `- Ver quién tiene acceso\n` +
    `- Asignar permisos y paquetes: "que Juan solo pueda usar recordatorios y rutinas"\n` +
    `- Ver y actuar sobre los datos de cualquier otra persona con acceso (pasando su nombre/número)\n` +
    `- Crear contraseñas temporales del portal web, y gestionar todo desde el portal (Administración)\n` +
    `- Modo prueba: */prueba* para usar el asistente como alguien con un paquete, */prueba salir* para volver`,
};

export interface MenuAccess {
  fashionEnabled: boolean;
  callsEnabled: boolean;
  isAdmin: boolean;
  /** Effective permissions of the person viewing the menu (see services/permissions/permissions.service.ts). */
  permissions: Set<string>;
}

/** Core categories this person may use, numbered 1..N in order - per-person numbering so a
 *  restricted user never sees gaps ("/menu 2" always means the 2nd line THEY see). */
function visibleCore(access: MenuAccess): MenuCategory[] {
  return CORE_CATEGORIES.filter((c) => categoryAllowed(c.key, access)).map((c, i) => ({ ...c, number: i + 1 }));
}

function visibleCategories(access: MenuAccess): MenuCategory[] {
  const extra: MenuCategory[] = [];
  if (categoryAllowed('agenda', access)) extra.push(AGENDA_CATEGORY);
  if (access.callsEnabled && categoryAllowed('llamadas', access)) extra.push(CALLS_CATEGORY);
  if (access.fashionEnabled && categoryAllowed('fashion', access)) extra.push(FASHION_CATEGORY);
  if (access.isAdmin) extra.push(STICKERS_CATEGORY, ADMIN_CATEGORY);
  return [...visibleCore(access), ...extra];
}

function isModeCategory(key: string): boolean {
  return (MODE_KEYS as readonly string[]).includes(key);
}

/**
 * The main menu: one line per section, numbered in the order shown. Typing the number or the name
 * opens it (see menuChoices) - entering the mode for the sections that are one, showing the detail
 * for the rest.
 */
export function renderMainMenu(access: MenuAccess): string {
  const rows = visibleCategories(access).map((cat, i) => `${keycap(i + 1)}  ${cat.emoji} *${cat.title}*`);
  return [
    '📋 *Menú de Canix*',
    'Escribe el *número* o el *nombre* de lo que quieras abrir.',
    '',
    ...rows,
    '',
    '> También puedes pedirme las cosas hablando normal',
    '> *salir* vuelve al inicio · */ayuda* muestra los comandos',
  ].join('\n');
}

/** What each number of the main menu opens, in the same order renderMainMenu lists them. */
export function menuChoices(access: MenuAccess): { label: string; reply: string }[] {
  return visibleCategories(access).map((cat) => ({
    label: cat.title,
    reply: isModeCategory(cat.key) ? cat.aliases[0] : `/menu ${cat.aliases[0]}`,
  }));
}

/** Welcome/intro message for the "we updated the bot" broadcast (see agent/tools/announce-update
 *  .tool.ts) - sent as its own message, right before renderFullGuide(), so the detailed guide lands
 *  as a separate WhatsApp bubble instead of one giant wall of text. */
export function renderUpdateAnnouncementIntro(): string {
  return (
    '🚀 *¡Canix tiene novedades!*\n\n' +
    'Actualizamos el bot - te cuento con detalle todo lo que puedo hacer por ti ahora, para que quede ' +
    'súper claro. Te mando la guía completa en el siguiente mensaje 👇'
  );
}

/** Full, unabbreviated guide: every visible category's complete detail block (not just the short
 *  one-liner from renderMainMenu) back to back - reuses each category's own `detail` text (the SAME
 *  one /menu <categoría> shows) so this can never drift from what's actually true. */
export function renderFullGuide(access: MenuAccess): string {
  const sections = visibleCategories(access).map((c) => [c.detail.split('\n')[0], '', ...styledBullets(c.detail)].join('\n'));
  sections.push(
    '👉 En cualquier momento escribe /menu para ver este resumen de nuevo, o /menu <categoría> para ' +
      'volver a leer el detalle de una sola.',
  );
  return sections.join('\n\n');
}

/** Resolves the text typed after "/menu " (already trimmed) to a category, matching a 1-9 number
 *  or any alias. Returns null when nothing matches - caller falls back to the main menu. */
export function resolveMenuCategory(input: string, access: MenuAccess): MenuCategory | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const asNumber = Number(text);
  if (Number.isInteger(asNumber)) {
    const byNumber = visibleCore(access).find((c) => c.number === asNumber);
    if (byNumber) return byNumber;
  }

  return visibleCategories(access).find((c) => c.aliases.includes(text)) ?? null;
}

/**
 * A section's help the way it's shown: each thing it does in bold, with its example quoted
 * underneath - instead of one long line per item where the example gets lost.
 *   🔹 *Crear con hora de aviso + duración*
 *   > "crea rutina de ejercicio a las 7am, 30 minutos"
 */
export function styledBullets(detail: string): string[] {
  const out: string[] = [];
  for (const line of detail.split('\n')) {
    const bullet = line.trim();
    if (!bullet.startsWith('- ')) continue;
    const text = bullet.slice(2).trim();
    const withExample = /^([^"]{3,90}?)\s*[:(]\s*("[^]*)$/.exec(text);
    if (withExample) {
      out.push(`🔹 *${withExample[1].trim()}*`, `> ${withExample[2].replace(/\)\s*$/, '').trim()}`);
    } else {
      out.push(text.length <= 70 ? `🔹 *${text}*` : `🔹 ${text}`);
    }
  }
  return out;
}

export function renderCategoryDetail(category: MenuCategory): string {
  const header = category.detail.split('\n')[0];
  return [header, 'Pídemelo hablando normal. Esto es lo que puedo hacer aquí:', '', ...styledBullets(category.detail)].join('\n') + NAV_FOOTER;
}

export function renderUnknownCategory(access: MenuAccess): string {
  return `🤔 No encontré esa categoría.\n\n${renderMainMenu(access)}`;
}
