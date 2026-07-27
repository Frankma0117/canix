import { CalendarClock, CalendarDays, ListTodo, Repeat, Link2, Tags, Users, Smartphone, LogOut } from 'lucide-react';
import type { SectionId } from '../App.tsx';
import { useAuth } from '../lib/auth.tsx';

const ITEMS: { id: SectionId; label: string; icon: typeof CalendarClock }[] = [
  { id: 'today', label: 'Hoy', icon: CalendarDays },
  { id: 'later', label: 'Para después', icon: ListTodo },
  { id: 'routines', label: 'Rutinas', icon: Repeat },
  { id: 'reminders', label: 'Recordatorios', icon: CalendarClock },
  { id: 'links', label: 'Links', icon: Link2 },
  { id: 'categories', label: 'Categorías', icon: Tags },
  { id: 'contacts', label: 'Contactos', icon: Users },
  { id: 'connection', label: 'Conexión', icon: Smartphone },
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: SectionId;
  onNavigate: (section: SectionId) => void;
}) {
  const { logout } = useAuth();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-gray-medium/70 bg-white px-3 py-5 dark:border-white/10 dark:bg-[#181411]">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-base text-white shadow-sm shadow-primary/30">
          🗂️
        </div>
        <div>
          <p className="font-display text-base font-semibold leading-none text-ink dark:text-white">
            Canix
          </p>
          <p className="text-xs text-gray-dark">Panel personal</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary-dark'
                  : 'text-gray-dark hover:bg-gray-light hover:text-ink dark:hover:bg-white/5 dark:hover:text-white'
              }`}
            >
              <Icon size={18} strokeWidth={2} />
              {label}
            </button>
          );
        })}
      </nav>

      <button
        onClick={logout}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-dark hover:bg-gray-light hover:text-error dark:hover:bg-white/5"
      >
        <LogOut size={18} />
        Bloquear panel
      </button>
    </aside>
  );
}
