import { LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';
import type { SectionDef } from '../lib/sections.tsx';

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
      {open && <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-gray-medium/70 bg-white px-3 py-5 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:border-white/10 dark:bg-[#15162c] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-5 flex items-center gap-2 px-2">
          <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-base text-white shadow-sm shadow-primary/30">🤖</div>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold leading-none text-ink dark:text-white">Cania</p>
            <p className="truncate text-xs text-gray-dark">
              {user?.name ?? 'Portal'}
              {user?.role === 'admin' ? ' · admin' : ''}
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-dark/70">{g}</p>
              <div className="space-y-0.5">
                {sections
                  .filter((s) => s.group === g)
                  .map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => onNavigate(id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        active === id
                          ? 'bg-primary/10 text-primary-dark'
                          : 'text-gray-dark hover:bg-gray-light hover:text-ink dark:hover:bg-white/5 dark:hover:text-white'
                      }`}
                    >
                      <Icon size={17} strokeWidth={2} />
                      {label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          onClick={logout}
          className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-dark hover:bg-gray-light hover:text-error dark:hover:bg-white/5"
        >
          <LogOut size={18} />
          Cerrar sesión
        </button>
      </aside>
    </>
  );
}
