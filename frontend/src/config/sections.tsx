import type { ComponentType, ReactNode } from 'react';
import {
  CalendarClock, CalendarDays, Clapperboard, CalendarSearch, ListTodo, ListChecks, Repeat, Link2, Tags, Users, Smartphone, Trophy, PhoneCall, StickyNote, UtensilsCrossed, BookOpen, Shirt, CalendarRange, CalendarCheck, ShieldCheck, Package, ScrollText, Building2, UserCog, Home, Grid3x3, BarChart3, LineChart, FlaskConical, Smile, Pill, } from 'lucide-react';
import type { StickerName } from '../components/atoms/Sticker.tsx';
import { HomePage } from '../pages/HomePage.tsx';
import { AccessMatrixPage } from '../pages/admin/AccessMatrixPage.tsx';
import { UsagePage } from '../pages/admin/UsagePage.tsx';
import { AnalyticsPage } from '../pages/admin/AnalyticsPage.tsx';
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

export interface SectionDef {
  id: string;
  label: string;
  group: string;
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
  { id: 'home', label: 'Inicio', group: 'General', icon: Home, render: () => <HomePage /> },
  { id: 'calendar', description: 'Tu semana por horas: rutinas, recordatorios, tareas, comidas, medicamentos y citas.', sticker: 'agendado', label: 'Calendario', group: 'Mi día', icon: CalendarSearch, perms: ['routines.manage', 'reminders.manage', 'todos.manage', 'meals.manage', 'medications.manage', 'reminders.calls', 'scheduling.professional', 'scheduling.client'], render: () => <CalendarPage /> },
  { id: 'today', description: 'Lo que tienes que hacer hoy, para ir marcando.', sticker: 'tareas', label: 'Hoy', group: 'Mi día', icon: CalendarDays, perms: ['todos.manage'], render: () => <TodosPage scope="today" title="Pendientes de hoy" /> },
  { id: 'later', description: 'Pendientes sin fecha fija.', sticker: 'idea', label: 'Para después', group: 'Mi día', icon: ListTodo, perms: ['todos.manage'], render: () => <TodosPage scope="later" title="Para después" /> },
  { id: 'lists', description: 'Listas de compras, películas, ideas…', sticker: 'compras', label: 'Listas', group: 'Mi día', icon: ListChecks, perms: ['todos.manage'], render: () => <ListsPage /> },
  { id: 'reminders', description: 'Recordatorios puntuales, recurrentes y fechas importantes.', sticker: 'agendado', label: 'Recordatorios', group: 'Mi día', icon: CalendarClock, perms: ['reminders.manage'], render: () => <RemindersPage /> },
  { id: 'call-reminders', description: 'Llamadas reales como recordatorio o alarma.', sticker: 'llamada', label: 'Llamadas', group: 'Mi día', icon: PhoneCall, perms: ['reminders.calls'], render: () => <CallRemindersPage /> },
  { id: 'routines', description: 'Hábitos con hora fija, rachas e historial.', sticker: 'rutina', label: 'Rutinas', group: 'Hábitos', icon: Repeat, perms: ['routines.manage'], render: () => <RoutinesPage /> },
  { id: 'rewards', description: 'Premios y castigos ligados a tus rutinas.', sticker: 'premio', label: 'Premios y castigos', group: 'Hábitos', icon: Trophy, perms: ['rewards.manage'], render: () => <RewardsPage /> },
  { id: 'meals', description: 'Desayuno, onces, almuerzo, media tarde y cena.', sticker: 'listo', label: 'Comidas', group: 'Hábitos', icon: UtensilsCrossed, perms: ['meals.manage'], render: () => <MealsPage /> },
  { id: 'medications', description: 'Medicamentos, vitaminas, cremas, skincare, agua y cuidado corporal (faja…) con su hora: Canix te avisa cuándo toca.', sticker: 'agendado', label: 'Medicamentos y belleza', group: 'Hábitos', icon: Pill, perms: ['medications.manage'], render: () => <MedicationsPage /> },
  { id: 'recipes', description: 'Tus recetas guardadas.', sticker: 'listo', label: 'Recetas', group: 'Hábitos', icon: BookOpen, perms: ['recipes.manage'], render: () => <RecipesPage /> },
  { id: 'library', description: 'Películas, series, música y libros: lo que tienes por ver y lo que ya viste.', sticker: 'idea', label: 'Biblioteca', group: 'Información', icon: Clapperboard, perms: ['library.manage'], render: () => <LibraryPage /> },
  { id: 'notes', description: 'Información importante para recuperar después.', sticker: 'nota', label: 'Notas', group: 'Información', icon: StickyNote, perms: ['notes.manage'], render: () => <NotesPage /> },
  { id: 'links', description: 'Tu biblioteca de links por categoría.', sticker: 'idea', label: 'Links', group: 'Información', icon: Link2, perms: ['links.manage'], render: () => <LinksPage /> },
  { id: 'categories', description: 'Generales: agrupan links, notas, recordatorios, tareas y recetas.', sticker: 'revisando', label: 'Categorías', group: 'Información', icon: Tags, perms: ['links.manage', 'reminders.manage', 'notes.manage', 'todos.manage', 'recipes.manage'], render: () => <CategoriesPage /> },
  { id: 'contacts', description: 'Las personas a las que el bot puede escribir.', sticker: 'mensaje', label: 'Contactos', group: 'Información', icon: Users, perms: ['contacts.manage'], render: () => <ContactsPage /> },
  { id: 'wardrobe', description: 'Tu armario digital y outfits.', sticker: 'enfoque', label: 'Mi armario', group: 'Información', icon: Shirt, perms: ['fashion.use'], render: () => <WardrobePage /> },
  { id: 'agenda', description: 'Tus horarios, citas y clientes.', sticker: 'evento', label: 'Mi agenda', group: 'Agenda', icon: CalendarRange, perms: ['scheduling.professional'], render: () => <ProfessionalAgendaPage /> },
  { id: 'my-appointments', description: 'Pide y revisa tus citas.', sticker: 'evento', label: 'Mis citas', group: 'Agenda', icon: CalendarCheck, perms: ['scheduling.client'], render: () => <MyAppointmentsPage /> },
  { id: 'admin-users', label: 'Personas', group: 'Administración', icon: ShieldCheck, adminOnly: true, render: () => <UsersPage /> },
  { id: 'admin-matrix', label: 'Matriz de acceso', group: 'Administración', icon: Grid3x3, adminOnly: true, render: () => <AccessMatrixPage /> },
  { id: 'admin-analytics', label: 'Analítica web', group: 'Administración', icon: LineChart, adminOnly: true, render: () => <AnalyticsPage /> },
  { id: 'admin-usage', label: 'Uso y costos', group: 'Administración', icon: BarChart3, adminOnly: true, render: () => <UsagePage /> },
  { id: 'admin-packages', label: 'Paquetes', group: 'Administración', icon: Package, adminOnly: true, render: () => <PackagesPage /> },
  { id: 'admin-stickers', label: 'Stickers', group: 'Administración', icon: Smile, adminOnly: true, render: () => <StickersPage /> },
  { id: 'admin-test-mode', label: 'Modo prueba', group: 'Administración', icon: FlaskConical, adminOnly: true, render: () => <TestModePage /> },
  { id: 'admin-scheduling', label: 'Agendas generales', group: 'Administración', icon: Building2, adminOnly: true, render: () => <SchedulingAdminPage /> },
  { id: 'admin-audit', label: 'Auditoría', group: 'Administración', icon: ScrollText, adminOnly: true, render: () => <AuditPage /> },
  { id: 'connection', label: 'Conexión WhatsApp', group: 'Administración', icon: Smartphone, adminOnly: true, render: () => <ConnectionPage /> },
  { id: 'account', label: 'Mi cuenta', group: 'Cuenta', icon: UserCog, render: () => <AccountPage /> },
];

export function visibleSections(isAdmin: boolean, can: (p: string) => boolean): SectionDef[] {
  return SECTIONS.filter((s) => (s.adminOnly ? isAdmin : !s.perms || isAdmin || s.perms.some(can)));
}
