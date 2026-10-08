import type { ComponentType, ReactNode } from 'react';
import {
  CalendarClock,
  CalendarDays,
  ListTodo,
  ListChecks,
  Repeat,
  Link2,
  Tags,
  Users,
  Smartphone,
  Trophy,
  PhoneCall,
  StickyNote,
  UtensilsCrossed,
  BookOpen,
  Shirt,
  CalendarRange,
  CalendarCheck,
  ShieldCheck,
  Package,
  ScrollText,
  Building2,
  UserCog,
} from 'lucide-react';
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
import { ListsPage } from '../pages/ListsPage.tsx';
import { MealsPage } from '../pages/MealsPage.tsx';
import { RecipesPage } from '../pages/RecipesPage.tsx';
import { WardrobePage } from '../pages/WardrobePage.tsx';
import { AccountPage } from '../pages/AccountPage.tsx';
import { ProfessionalAgendaPage } from '../pages/scheduling/ProfessionalAgendaPage.tsx';
import { MyAppointmentsPage } from '../pages/scheduling/MyAppointmentsPage.tsx';
import { UsersPage } from '../pages/admin/UsersPage.tsx';
import { PackagesPage } from '../pages/admin/PackagesPage.tsx';
import { AuditPage } from '../pages/admin/AuditPage.tsx';
import { SchedulingAdminPage } from '../pages/admin/SchedulingAdminPage.tsx';

export interface SectionDef {
  id: string;
  label: string;
  group: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Visible if the user has ANY of these permissions. Omitted = everyone. */
  perms?: string[];
  adminOnly?: boolean;
  render: () => ReactNode;
}

/**
 * Every portal section and the permission that unlocks it - the same keys the server enforces
 * (server/http-server.ts + permissions/catalog.ts). Hiding a section here is only convenience:
 * the API rejects anything the person isn't allowed to use regardless.
 */
export const SECTIONS: SectionDef[] = [
  { id: 'today', label: 'Hoy', group: 'Mi día', icon: CalendarDays, perms: ['todos.manage'], render: () => <TodosPage scope="today" title="Pendientes de hoy" /> },
  { id: 'later', label: 'Para después', group: 'Mi día', icon: ListTodo, perms: ['todos.manage'], render: () => <TodosPage scope="later" title="Para después" /> },
  { id: 'lists', label: 'Listas', group: 'Mi día', icon: ListChecks, perms: ['todos.manage'], render: () => <ListsPage /> },
  { id: 'reminders', label: 'Recordatorios', group: 'Mi día', icon: CalendarClock, perms: ['reminders.manage'], render: () => <RemindersPage /> },
  { id: 'call-reminders', label: 'Llamadas', group: 'Mi día', icon: PhoneCall, perms: ['reminders.calls'], render: () => <CallRemindersPage /> },
  { id: 'routines', label: 'Rutinas', group: 'Hábitos', icon: Repeat, perms: ['routines.manage'], render: () => <RoutinesPage /> },
  { id: 'rewards', label: 'Premios y castigos', group: 'Hábitos', icon: Trophy, perms: ['rewards.manage'], render: () => <RewardsPage /> },
  { id: 'meals', label: 'Comidas', group: 'Hábitos', icon: UtensilsCrossed, perms: ['meals.manage'], render: () => <MealsPage /> },
  { id: 'recipes', label: 'Recetas', group: 'Hábitos', icon: BookOpen, perms: ['recipes.manage'], render: () => <RecipesPage /> },
  { id: 'notes', label: 'Notas', group: 'Información', icon: StickyNote, perms: ['notes.manage'], render: () => <NotesPage /> },
  { id: 'links', label: 'Links', group: 'Información', icon: Link2, perms: ['links.manage'], render: () => <LinksPage /> },
  { id: 'categories', label: 'Categorías', group: 'Información', icon: Tags, perms: ['links.manage', 'reminders.manage', 'notes.manage'], render: () => <CategoriesPage /> },
  { id: 'contacts', label: 'Contactos', group: 'Información', icon: Users, perms: ['contacts.manage'], render: () => <ContactsPage /> },
  { id: 'wardrobe', label: 'Mi armario', group: 'Información', icon: Shirt, perms: ['fashion.use'], render: () => <WardrobePage /> },
  { id: 'agenda', label: 'Mi agenda', group: 'Agenda', icon: CalendarRange, perms: ['scheduling.professional'], render: () => <ProfessionalAgendaPage /> },
  { id: 'my-appointments', label: 'Mis citas', group: 'Agenda', icon: CalendarCheck, perms: ['scheduling.client'], render: () => <MyAppointmentsPage /> },
  { id: 'admin-users', label: 'Usuarios y permisos', group: 'Administración', icon: ShieldCheck, adminOnly: true, render: () => <UsersPage /> },
  { id: 'admin-packages', label: 'Paquetes', group: 'Administración', icon: Package, adminOnly: true, render: () => <PackagesPage /> },
  { id: 'admin-scheduling', label: 'Agendas generales', group: 'Administración', icon: Building2, adminOnly: true, render: () => <SchedulingAdminPage /> },
  { id: 'admin-audit', label: 'Auditoría', group: 'Administración', icon: ScrollText, adminOnly: true, render: () => <AuditPage /> },
  { id: 'connection', label: 'Conexión WhatsApp', group: 'Administración', icon: Smartphone, adminOnly: true, render: () => <ConnectionPage /> },
  { id: 'account', label: 'Mi cuenta', group: 'Cuenta', icon: UserCog, render: () => <AccountPage /> },
];

export function visibleSections(isAdmin: boolean, can: (p: string) => boolean): SectionDef[] {
  return SECTIONS.filter((s) => (s.adminOnly ? isAdmin : !s.perms || isAdmin || s.perms.some(can)));
}
