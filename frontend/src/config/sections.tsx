import type { ComponentType, ReactNode } from 'react';
import {
  CalendarClock, CalendarDays, Clapperboard, CalendarSearch, ListTodo, ListChecks, Repeat, Link2, Tags, Users, Smartphone, Trophy, PhoneCall, StickyNote, UtensilsCrossed, BookOpen, Shirt, CalendarRange, CalendarCheck, ShieldCheck, Package, ScrollText, Building2, UserCog, Home, Grid3x3, BarChart3, LineChart, FlaskConical, Smile, Pill, Megaphone, Send, Plug, Dumbbell, ShoppingBag, MessagesSquare, Bot, Store, LayoutDashboard, Tag, BadgePercent, SlidersHorizontal, Wallet } from 'lucide-react';
import type { StickerName } from '../components/atoms/Sticker.tsx';
import { HomePage } from '../pages/HomePage.tsx';
import { AccessMatrixPage } from '../pages/admin/AccessMatrixPage.tsx';
import { UsagePage } from '../pages/admin/UsagePage.tsx';
import { AnalyticsPage } from '../pages/admin/AnalyticsPage.tsx';
import { PromoPage } from '../pages/admin/PromoPage.tsx';
import { PublisherPage } from '../pages/admin/PublisherPage.tsx';
import { ConnectedProjectsPage } from '../pages/admin/ConnectedProjectsPage.tsx';
import { TodosPage } from '../pages/TodosPage.tsx';
import { RoutinesPage } from '../pages/RoutinesPage.tsx';
import { RewardsPage } from '../pages/RewardsPage.tsx';
import { RemindersPage } from '../pages/RemindersPage.tsx';
import { CallRemindersPage } from '../pages/CallRemindersPage.tsx';
import { LinksPage } from '../pages/LinksPage.tsx';
import { CategoriesPage } from '../pages/CategoriesPage.tsx';
import { ContactsPage } from '../pages/ContactsPage.tsx';
import { ConnectionPage } from '../pages/ConnectionPage.tsx';
import { NotesPage } from '../pages/NotesPage.tsx';
import { LibraryPage } from '../pages/LibraryPage.tsx';
import { CalendarPage } from '../pages/CalendarPage.tsx';
import { ListsPage } from '../pages/ListsPage.tsx';
import { MealsPage } from '../pages/MealsPage.tsx';
import { MedicationsPage } from '../pages/MedicationsPage.tsx';
import { WorkoutsPage } from '../pages/WorkoutsPage.tsx';
import { RecipesPage } from '../pages/RecipesPage.tsx';
import { WardrobePage } from '../pages/WardrobePage.tsx';
import { AccountPage } from '../pages/AccountPage.tsx';
import { ProfessionalAgendaPage } from '../pages/scheduling/ProfessionalAgendaPage.tsx';
import { MyAppointmentsPage } from '../pages/scheduling/MyAppointmentsPage.tsx';
import { UsersPage } from '../pages/admin/UsersPage.tsx';
import { PackagesPage } from '../pages/admin/PackagesPage.tsx';
import { AuditPage } from '../pages/admin/AuditPage.tsx';
import { SchedulingAdminPage } from '../pages/admin/SchedulingAdminPage.tsx';
import { TestModePage } from '../pages/admin/TestModePage.tsx';
import { StickersPage } from '../pages/admin/StickersPage.tsx';
import { StoresAdminPage } from '../pages/admin/StoresAdminPage.tsx';
import { StoreOrdersPage } from '../pages/store/StoreOrdersPage.tsx';
import { StoreCatalogPage } from '../pages/store/StoreCatalogPage.tsx';
import { StoreBookingPage } from '../pages/store/StoreBookingPage.tsx';
import { StoreChatsPage } from '../pages/store/StoreChatsPage.tsx';
import { StoreHomePage } from '../pages/store/StoreHomePage.tsx';
import { StoreBotPage } from '../pages/store/StoreBotPage.tsx';

export type ModuleId = 'personal' | 'business' | 'platform';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  hint: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

export const MODULES: ModuleDef[] = [
  { id: 'personal', label: 'Mi Canix', hint: 'Tu asistente personal', icon: Home },
  { id: 'business', label: 'Negocios', hint: 'Asistente de pedidos', icon: Store },
  { id: 'platform', label: 'Plataforma', hint: 'Administración de Canix', icon: ShieldCheck },
];

export interface SectionDef {
  id: string;
  label: string;
  group: string;
  /** Which module of the menu it belongs to (see MODULES). */
  module: ModuleId;
  /** Not listed in the menu (reachable from elsewhere). */
  hidden?: boolean;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Visible if the user has ANY of these permissions. Omitted = everyone. */
  perms?: string[];
  adminOnly?: boolean;
  /** One line for the home screen's module tiles. */
  description?: string;
  sticker?: StickerName;
  render: () => ReactNode;
}

/**
 * Every portal section and the permission that unlocks it - the same keys the server enforces
 * (api/server.ts + services/permissions/catalog.ts). Hiding a section here is only convenience:
 * the API rejects anything the person isn't allowed to use regardless.
 */
const SECTIONS: SectionDef[] = [
  { id: 'home', label: 'Inicio', module: 'personal', group: 'General', icon: Home, render: () => <HomePage /> },
  { id: 'calendar', description: 'Tu semana por horas: rutinas, recordatorios, tareas, comidas, medicamentos y citas.', sticker: 'agendado', label: 'Calendario', module: 'personal', group: 'Mi día', icon: CalendarSearch, perms: ['routines.manage', 'reminders.manage', 'todos.manage', 'meals.manage', 'medications.manage', 'workouts.manage', 'reminders.calls', 'scheduling.professional', 'scheduling.client'], render: () => <CalendarPage /> },
  { id: 'today', description: 'Lo que tienes que hacer hoy, para ir marcando.', sticker: 'tareas', label: 'Hoy', module: 'personal', group: 'Mi día', icon: CalendarDays, perms: ['todos.manage'], render: () => <TodosPage scope="today" title="Pendientes de hoy" /> },
  { id: 'later', description: 'Pendientes sin fecha fija.', sticker: 'idea', label: 'Para después', module: 'personal', group: 'Mi día', icon: ListTodo, perms: ['todos.manage'], render: () => <TodosPage scope="later" title="Para después" /> },
  { id: 'lists', description: 'Listas de compras, películas, ideas…', sticker: 'compras', label: 'Listas', module: 'personal', group: 'Mi día', icon: ListChecks, perms: ['todos.manage'], render: () => <ListsPage /> },
  { id: 'reminders', description: 'Recordatorios puntuales, recurrentes y fechas importantes.', sticker: 'agendado', label: 'Recordatorios', module: 'personal', group: 'Mi día', icon: CalendarClock, perms: ['reminders.manage'], render: () => <RemindersPage /> },
  { id: 'call-reminders', description: 'Llamadas reales como recordatorio o alarma.', sticker: 'llamada', label: 'Llamadas', module: 'personal', group: 'Mi día', icon: PhoneCall, perms: ['reminders.calls'], render: () => <CallRemindersPage /> },
  { id: 'routines', description: 'Hábitos con hora fija, rachas e historial.', sticker: 'rutina', label: 'Rutinas', module: 'personal', group: 'Hábitos', icon: Repeat, perms: ['routines.manage'], render: () => <RoutinesPage /> },
  { id: 'workouts', description: 'Boxeo, zumba, gym, correr, yoga… con su horario, sesiones y minutos de la semana y tu racha.', sticker: 'vamos', label: 'Ejercicios', module: 'personal', group: 'Hábitos', icon: Dumbbell, perms: ['workouts.manage'], render: () => <WorkoutsPage /> },
  { id: 'rewards', description: 'Premios y castigos ligados a tus rutinas.', sticker: 'premio', label: 'Premios y castigos', module: 'personal', group: 'Hábitos', icon: Trophy, perms: ['rewards.manage'], render: () => <RewardsPage /> },
  { id: 'meals', description: 'Desayuno, onces, almuerzo, media tarde y cena.', sticker: 'listo', label: 'Comidas', module: 'personal', group: 'Hábitos', icon: UtensilsCrossed, perms: ['meals.manage'], render: () => <MealsPage /> },
  { id: 'medications', description: 'Medicamentos, vitaminas, cremas, skincare, agua y cuidado corporal (faja…) con su hora: Canix te avisa cuándo toca.', sticker: 'agendado', label: 'Medicamentos y belleza', module: 'personal', group: 'Hábitos', icon: Pill, perms: ['medications.manage'], render: () => <MedicationsPage /> },
  { id: 'recipes', description: 'Tus recetas guardadas.', sticker: 'listo', label: 'Recetas', module: 'personal', group: 'Hábitos', icon: BookOpen, perms: ['recipes.manage'], render: () => <RecipesPage /> },
  { id: 'library', description: 'Películas, series, música y libros: lo que tienes por ver y lo que ya viste.', sticker: 'idea', label: 'Biblioteca', module: 'personal', group: 'Información', icon: Clapperboard, perms: ['library.manage'], render: () => <LibraryPage /> },
  { id: 'notes', description: 'Información importante para recuperar después.', sticker: 'nota', label: 'Notas', module: 'personal', group: 'Información', icon: StickyNote, perms: ['notes.manage'], render: () => <NotesPage /> },
  { id: 'links', description: 'Tu biblioteca de links por categoría.', sticker: 'idea', label: 'Links', module: 'personal', group: 'Información', icon: Link2, perms: ['links.manage'], render: () => <LinksPage /> },
  { id: 'categories', description: 'Generales: agrupan links, notas, recordatorios, tareas y recetas.', sticker: 'revisando', label: 'Categorías', module: 'personal', group: 'Información', icon: Tags, perms: ['links.manage', 'reminders.manage', 'notes.manage', 'todos.manage', 'recipes.manage'], render: () => <CategoriesPage /> },
  { id: 'contacts', description: 'Las personas a las que el bot puede escribir.', sticker: 'mensaje', label: 'Contactos', module: 'personal', group: 'Información', icon: Users, perms: ['contacts.manage'], render: () => <ContactsPage /> },
  { id: 'wardrobe', description: 'Tu armario digital y outfits.', sticker: 'enfoque', label: 'Mi armario', module: 'personal', group: 'Información', icon: Shirt, perms: ['fashion.use'], render: () => <WardrobePage /> },
  { id: 'agenda', description: 'Tus horarios, citas y clientes.', sticker: 'evento', label: 'Mi agenda', module: 'personal', group: 'Agenda', icon: CalendarRange, perms: ['scheduling.professional'], render: () => <ProfessionalAgendaPage /> },
  { id: 'my-appointments', description: 'Pide y revisa tus citas.', sticker: 'evento', label: 'Mis citas', module: 'personal', group: 'Agenda', icon: CalendarCheck, perms: ['scheduling.client'], render: () => <MyAppointmentsPage /> },
  // Asistente de pedidos: the business administrator sees only these (plus Mi cuenta).
  // Módulo Negocio: lo que ve el administrador de un negocio (y el administrador de Canix al entrar a soportarlo).
  { id: 'store-home', description: 'Cómo va el negocio hoy y qué falta por configurar.', label: 'Resumen', module: 'business', group: 'Operación', icon: LayoutDashboard, perms: ['store.manage'], render: () => <StoreHomePage /> },
  { id: 'store-orders', description: 'Pedidos que tus clientes confirmaron por WhatsApp, para confirmar y enviar.', label: 'Pedidos', module: 'business', group: 'Operación', icon: ShoppingBag, perms: ['store.manage'], render: () => <StoreOrdersPage /> },
  { id: 'store-bookings', description: 'Las citas que tus clientes agendaron por WhatsApp, tu equipo, los servicios y lo que el asistente sabe del negocio.', label: 'Citas', module: 'business', group: 'Operación', icon: CalendarDays, perms: ['store.manage'], render: () => <StoreBookingPage /> },
  { id: 'store-chats', description: 'Los chats del WhatsApp del negocio y los clientes que esperan a una persona.', label: 'Conversaciones', module: 'business', group: 'Operación', icon: MessagesSquare, perms: ['store.manage'], render: () => <StoreChatsPage /> },
  { id: 'store-products', description: 'Productos con precio, foto y categorías.', label: 'Productos', module: 'business', group: 'Catálogo', icon: Tag, perms: ['store.manage'], render: () => <StoreCatalogPage view="products" /> },
  { id: 'store-promos', description: 'Promociones del día y por fechas.', label: 'Promociones', module: 'business', group: 'Catálogo', icon: BadgePercent, perms: ['store.manage'], render: () => <StoreCatalogPage view="promotions" /> },
  { id: 'store-test', description: 'Escríbele como un cliente para ver cómo atiende.', label: 'Probar', module: 'business', group: 'Asistente', icon: Bot, perms: ['store.manage'], render: () => <StoreBotPage tab="test" /> },
  { id: 'store-attention', description: 'Tono, horarios y cuándo pasa a una persona.', label: 'Cómo atiende', module: 'business', group: 'Asistente', icon: SlidersHorizontal, perms: ['store.manage'], render: () => <StoreBotPage tab="attention" /> },
  { id: 'store-whatsapp', description: 'Vincula el número de WhatsApp del negocio.', label: 'WhatsApp', module: 'business', group: 'Asistente', icon: Smartphone, perms: ['store.manage'], render: () => <StoreBotPage tab="whatsapp" /> },
  { id: 'store-business', description: 'Dirección, pagos y envíos.', label: 'Datos y pagos', module: 'business', group: 'Negocio', icon: Wallet, perms: ['store.manage'], render: () => <StoreBotPage tab="business" /> },
  { id: 'store-team', description: 'Quién administra este negocio.', label: 'Equipo', module: 'business', group: 'Negocio', icon: Users, perms: ['store.manage'], render: () => <StoreBotPage tab="team" /> },
  // Compatibilidad: enlaces viejos (#/store-bot?tab=whatsapp, #/store-catalog).
  { id: 'store-bot', label: 'Asistente', module: 'business', group: 'Asistente', hidden: true, icon: Bot, perms: ['store.manage'], render: () => <StoreBotPage /> },
  { id: 'store-catalog', label: 'Catálogo', module: 'business', group: 'Catálogo', hidden: true, icon: Tag, perms: ['store.manage'], render: () => <StoreCatalogPage /> },
  { id: 'admin-users', label: 'Personas', module: 'platform', group: 'Accesos', icon: ShieldCheck, adminOnly: true, render: () => <UsersPage /> },
  { id: 'admin-matrix', label: 'Matriz de acceso', module: 'platform', group: 'Accesos', icon: Grid3x3, adminOnly: true, render: () => <AccessMatrixPage /> },
  { id: 'admin-analytics', label: 'Analítica web', module: 'platform', group: 'Crecimiento', icon: LineChart, adminOnly: true, render: () => <AnalyticsPage /> },
  { id: 'admin-usage', label: 'Uso y costos', module: 'platform', group: 'Crecimiento', icon: BarChart3, adminOnly: true, render: () => <UsagePage /> },
  { id: 'admin-promo', label: 'Videos y publicidad', module: 'platform', group: 'Crecimiento', icon: Megaphone, adminOnly: true, render: () => <PromoPage /> },
  { id: 'admin-publisher', label: 'Publicador', module: 'platform', group: 'Crecimiento', icon: Send, adminOnly: true, render: () => <PublisherPage /> },
  { id: 'admin-notify', label: 'Proyectos conectados', module: 'platform', group: 'Sistema', icon: Plug, adminOnly: true, render: () => <ConnectedProjectsPage /> },
  { id: 'admin-packages', label: 'Paquetes', module: 'platform', group: 'Accesos', icon: Package, adminOnly: true, render: () => <PackagesPage /> },
  { id: 'admin-stickers', label: 'Stickers', module: 'platform', group: 'Crecimiento', icon: Smile, adminOnly: true, render: () => <StickersPage /> },
  { id: 'admin-test-mode', label: 'Modo prueba', module: 'platform', group: 'Sistema', icon: FlaskConical, adminOnly: true, render: () => <TestModePage /> },
  { id: 'admin-scheduling', label: 'Agendas generales', module: 'platform', group: 'Sistema', icon: Building2, adminOnly: true, render: () => <SchedulingAdminPage /> },
  { id: 'admin-stores', label: 'Negocios', module: 'business', group: 'Todos los negocios', icon: Store, adminOnly: true, render: () => <StoresAdminPage /> },
  { id: 'admin-audit', label: 'Auditoría', module: 'platform', group: 'Sistema', icon: ScrollText, adminOnly: true, render: () => <AuditPage /> },
  { id: 'connection', label: 'Conexión WhatsApp', module: 'platform', group: 'Sistema', icon: Smartphone, adminOnly: true, render: () => <ConnectionPage /> },
  { id: 'account', label: 'Mi cuenta', module: 'personal', group: 'Cuenta', hidden: true, icon: UserCog, render: () => <AccountPage /> },
];

export function visibleSections(isAdmin: boolean, can: (p: string) => boolean, storeOnly = false): SectionDef[] {
  const visible = SECTIONS.filter((s) => (s.adminOnly ? isAdmin : !s.perms || isAdmin || s.perms.some(can)));
  // A business administrator works in their business: nothing of the personal assistant or the platform.
  return storeOnly ? visible.filter((s) => s.module === 'business' || s.id === 'account') : visible;
}

/** The modules a person can switch between, in menu order (only those with something to show). */
export function visibleModules(sections: SectionDef[]): ModuleDef[] {
  return MODULES.filter((m) => sections.some((s) => s.module === m.id && !s.hidden));
}
