/**
 * Single source of truth for WHAT can be granted: every user-facing feature of the bot is one
 * permission, and each permission owns the exact set of agent tools it unlocks (and, for the web
 * portal, which section it shows - see server/http-server.ts / admin-panel). Synced into the
 * `permissions` table at every boot (see permissions.repo.ts's syncCatalog), so the database can
 * enforce foreign keys against it, but the code here is what defines it - adding a feature means
 * adding it here, nowhere else.
 *
 * Who gets what is decided ONLY by the administrator (packages + per-user allow/deny - see
 * permissions/engine.ts). The one narrow exception is scheduling: a professional may share
 * `scheduling.client` with their own clients (see scheduling/service.ts), and nothing else.
 */

export interface PermissionDef {
  key: string;
  module: string;
  label: string;
  description: string;
  /** Agent tools this permission unlocks. */
  tools: string[];
  /**
   * Costs the owner real money per use (Twilio calls, Fish Audio voice...) and will be charged for
   * separately: never part of a package, only granted one person at a time as a direct 'allow'
   * (see permissions.repo.ts's savePackage and engine.ts's migrateBillableOutOfPackages).
   */
  billable?: boolean;
}

export const PERMISSIONS: PermissionDef[] = [
  {
    key: 'reminders.manage',
    module: 'Recordatorios',
    label: 'Recordatorios',
    description: 'Crear, ver, editar, pausar y borrar recordatorios (puntuales, fechas importantes, flexibles, por intervalos).',
    tools: [
      'schedule_reminder',
      'list_reminders',
      'cancel_reminder',
      'edit_reminder',
      'delete_reminder',
      'schedule_important_date',
      'schedule_flexible_reminder',
      'schedule_interval_reminder',
      'pause_reminder',
      'resume_reminder',
      'pause_notifications',
      'resume_notifications',
    ],
  },
  {
    key: 'routines.manage',
    module: 'Rutinas',
    label: 'Rutinas y hábitos',
    description: 'Crear rutinas con hora fija, marcarlas, ver racha e historial, ejercicios por rutina.',
    tools: [
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
  },
  {
    key: 'todos.manage',
    module: 'Tareas',
    label: 'Tareas y listas',
    description: 'Pendientes de hoy o para después, y listas para ir marcando.',
    tools: [
      'add_todo',
      'list_todos',
      'complete_todo',
      'delete_todo',
      'edit_todo',
      'create_list',
      'add_list_item',
      'list_lists',
      'view_list',
      'check_list_item',
      'delete_list_item',
      'delete_list',
    ],
  },
  {
    key: 'notes.manage',
    module: 'Notas',
    label: 'Notas',
    description: 'Guardar, buscar, editar y borrar notas.',
    tools: ['add_note', 'list_notes', 'edit_note', 'delete_note'],
  },
  {
    key: 'links.manage',
    module: 'Links',
    label: 'Links y categorías',
    description: 'Guardar links por categoría, pedir uno al azar, gestionar categorías.',
    tools: ['save_link', 'list_links', 'pick_link', 'edit_link', 'delete_link', 'create_category', 'list_categories', 'edit_category', 'delete_category'],
  },
  {
    key: 'contacts.manage',
    module: 'Contactos',
    label: 'Contactos',
    description: 'Guardar, ver, editar y borrar contactos.',
    tools: ['add_contact', 'list_contacts', 'edit_contact', 'delete_contact'],
  },
  {
    key: 'messages.send',
    module: 'Contactos',
    label: 'Enviar mensajes',
    description: 'Pedirle al bot que le escriba a otra persona por WhatsApp.',
    tools: ['send_message'],
  },
  {
    key: 'meals.manage',
    module: 'Comidas',
    label: 'Plan de comidas',
    description: 'Planear desayuno, almuerzo, cena y onces por día.',
    tools: ['plan_meal', 'list_meal_plan', 'delete_meal_plan', 'edit_meal_plan'],
  },
  {
    key: 'recipes.manage',
    module: 'Comidas',
    label: 'Recetas',
    description: 'Guardar y consultar recetas.',
    tools: ['save_recipe', 'list_recipes', 'get_recipe', 'delete_recipe', 'edit_recipe'],
  },
  {
    key: 'rewards.manage',
    module: 'Premios',
    label: 'Premios y castigos',
    description: 'Premios y castigos ligados a las rutinas.',
    tools: ['register_reward_punishment', 'list_rewards_punishments', 'delete_reward_punishment'],
  },
  {
    key: 'summaries.view',
    module: 'Resúmenes',
    label: 'Resúmenes',
    description: 'Agenda del día y reporte semanal.',
    tools: ['get_today_agenda', 'get_week_report'],
  },
  {
    key: 'fashion.use',
    module: 'Fashion',
    label: 'Modo Fashion',
    description: 'Armario digital y recomendaciones de outfits.',
    tools: ['set_fashion_profile'],
  },
  {
    key: 'scheduling.professional',
    module: 'Agendamiento',
    label: 'Agenda (profesional)',
    description: 'Tener agenda propia: horarios, ver/confirmar/cancelar/programar citas, compartir acceso a clientes, calendario web.',
    tools: [
      'set_availability',
      'view_availability',
      'block_time',
      'unblock_time',
      'list_appointments',
      'confirm_appointment',
      'reject_appointment',
      'cancel_appointment',
      'schedule_appointment',
      'share_scheduling_access',
      'list_scheduling_clients',
      'remove_scheduling_client',
      'set_scheduling_settings',
    ],
  },
  {
    key: 'scheduling.client',
    module: 'Agendamiento',
    label: 'Agendar citas (cliente)',
    description: 'Ver espacios disponibles de sus profesionales, pedir citas y ver/cancelar las suyas.',
    tools: ['list_my_professionals', 'list_available_slots', 'request_appointment', 'list_my_appointments', 'cancel_my_appointment'],
  },
  {
    key: 'portal.access',
    module: 'Portal web',
    label: 'Acceso al portal web',
    description: 'Iniciar sesión en el portal web con número y contraseña (ve solo los módulos que tenga permitidos).',
    tools: ['change_web_password'],
  },
  // ---------------- Extras de pago (each use costs money - granted per person, never by package) ----
  {
    key: 'reminders.calls',
    module: 'Extras de pago',
    label: 'Llamadas telefónicas',
    description:
      'Llamadas reales (Twilio) como recordatorio o alarma, tanto si la persona las pide como si el bot se las ofrece. Cada llamada tiene costo.',
    tools: ['schedule_call_reminder', 'list_call_reminders', 'edit_call_reminder', 'cancel_call_reminder', 'delete_call_reminder'],
    billable: true,
  },
  {
    key: 'voice.premium',
    module: 'Extras de pago',
    label: 'Voz natural (IA)',
    description:
      'Notas de voz y llamadas con voz humana natural (Fish Audio), masculina o femenina según la persona. Sin este permiso se usa la voz local gratuita.',
    tools: [],
    billable: true,
  },
];

export function isBillable(key: string): boolean {
  return !!PERMISSIONS.find((p) => p.key === key)?.billable;
}

/** Available to anyone with access, whatever their permissions - navigation and personal
 *  preferences that don't touch any feature's data. */
export const BASE_TOOLS = ['show_menu', 'set_user_gender', 'set_voice_gender', 'send_sticker'];

/** Only ever for the administrator - never assignable through permissions. Each also checks
 *  ctx.isAdmin itself (defense in depth). */
export const ADMIN_ONLY_TOOLS = [
  'grant_access',
  'revoke_access',
  'list_users',
  'set_user_permissions',
  'get_user_permissions',
  'list_permissions',
  'manage_permission_package',
  'set_web_password',
  'manage_scheduling_group',
  'list_stickers',
  'delete_sticker',
  'announce_update',
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export function isPermissionKey(key: string): boolean {
  return PERMISSION_KEYS.includes(key);
}

export interface PackageDef {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

// No billable permission here on purpose (see PermissionDef.billable).
const PERSONAL = [
  'reminders.manage',
  'routines.manage',
  'todos.manage',
  'notes.manage',
  'links.manage',
  'contacts.manage',
  'messages.send',
  'meals.manage',
  'recipes.manage',
  'rewards.manage',
  'summaries.view',
  'fashion.use',
];

/** Seeded once (system packages, see permissions.repo.ts) - the admin can then edit their
 *  contents or create new ones; seeding never overwrites an edit. */
export const DEFAULT_PACKAGES: PackageDef[] = [
  {
    key: 'completo',
    name: 'Asistente completo',
    description: 'Todas las funciones personales del asistente y el portal web (sin agendamiento).',
    permissions: [...PERSONAL, 'portal.access'],
  },
  {
    key: 'organizacion',
    name: 'Organización personal',
    description: 'Recordatorios, rutinas, tareas, notas, links y resúmenes.',
    permissions: ['reminders.manage', 'routines.manage', 'todos.manage', 'notes.manage', 'links.manage', 'summaries.view'],
  },
  {
    key: 'recordatorios',
    name: 'Solo recordatorios',
    description: 'Únicamente crear y gestionar recordatorios.',
    permissions: ['reminders.manage'],
  },
  {
    key: 'bienestar',
    name: 'Bienestar',
    description: 'Rutinas, comidas, recetas, premios y resúmenes.',
    permissions: ['routines.manage', 'meals.manage', 'recipes.manage', 'rewards.manage', 'summaries.view'],
  },
  {
    key: 'profesional',
    name: 'Profesional de agenda',
    description: 'Agenda propia con calendario web, más recordatorios.',
    permissions: ['scheduling.professional', 'reminders.manage', 'portal.access'],
  },
  {
    key: 'demo',
    name: 'Demo (prueba gratis)',
    description: 'Cuentas de prueba creadas desde la página pública: todo lo personal, agenda y portal, sin extras de pago.',
    permissions: [...PERSONAL, 'scheduling.professional', 'portal.access'],
  },
  {
    key: 'cliente_agenda',
    name: 'Cliente de agenda',
    description: 'Solo pedir y ver sus citas con los profesionales que lo compartieron.',
    permissions: ['scheduling.client'],
  },
];

/** Every tool unlocked by the given permissions (plus BASE_TOOLS). */
export function toolsForPermissions(perms: Iterable<string>): string[] {
  const set = new Set<string>(BASE_TOOLS);
  for (const key of perms) {
    const def = PERMISSIONS.find((p) => p.key === key);
    if (def) def.tools.forEach((t) => set.add(t));
  }
  return [...set];
}

/** Reverse lookup: which permission owns a tool (undefined = base or admin-only). */
export function permissionForTool(tool: string): string | undefined {
  return PERMISSIONS.find((p) => p.tools.includes(tool))?.key;
}
