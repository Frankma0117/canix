import { LogOut, X } from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';
import type { SectionDef } from '../lib/sections.tsx';
import { Logo } from './brand/Logo.tsx';
import { Avatar } from './ui/Page.tsx';

export function Sidebar({
  sections,
  active,
  onNavigate,
  open,
  onClose,
}: {
  sections: SectionDef[];
  active: string;
  onNavigate: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const { logout, user } = useAuth();
  const groups = [...new Set(sections.map((s) => s.group))];

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm animate-fade-in lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-gray-medium/60 bg-white/95 backdrop-blur-xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:border-white/10 dark:bg-[#10143a]/95 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-5">
          <Logo size={42} subtitle={user?.role === 'admin' ? 'Panel de administración' : 'Tu asistente personal'} />
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-dark hover:bg-gray-medium/60 lg:hidden" aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-dark/70">{g}</p>
              <div className="space-y-0.5">
                {sections
                  .filter((s) => s.group === g)
                  .map(({ id, label, icon: Icon }) => {
                    const isActive = active === id;
                    return (
                      <button
                        key={id}
                        onClick={() => onNavigate(id)}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                          isActive
                            ? 'bg-gradient-to-r from-primary/12 to-accent/10 text-primary-dark dark:from-primary/25 dark:to-accent/20 dark:text-white'
                            : 'text-gray-dark hover:bg-gray-light hover:text-ink dark:hover:bg-white/5 dark:hover:text-white'
                        }`}
                      >
                        {isActive && <span className="brand-gradient absolute inset-y-1.5 left-0 w-1 rounded-full" />}
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                            isActive ? 'brand-gradient text-white shadow-md shadow-primary/30' : 'bg-gray-light text-gray-dark group-hover:text-primary dark:bg-white/5'
                          }`}
                        >
                          <Icon size={16} strokeWidth={2.2} />
                        </span>
                        {label}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="m-3 rounded-2xl border border-gray-medium/60 bg-gray-light/80 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <Avatar name={user?.name ?? null} seed={user?.id ?? 0} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink dark:text-white">{user?.name ?? 'Tu cuenta'}</p>
              <p className="truncate text-xs text-gray-dark">{user?.role === 'admin' ? 'Administrador' : user?.phoneKnown === false ? 'Número por confirmar' : `+${user?.phone ?? ''}`}</p>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-gray-dark hover:bg-white hover:text-error dark:hover:bg-white/10" aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
