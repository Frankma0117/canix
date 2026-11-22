import { useEffect, useState } from 'react';
import { ChevronDown, LogOut, X } from 'lucide-react';
import { useAuth } from '../../../services/auth.tsx';
import { MODULES, type ModuleDef, type ModuleId, type SectionDef } from '../../../config/sections.tsx';
import { Logo } from '../../atoms/Logo.tsx';
import { Avatar } from '../../atoms/Avatar.tsx';

const OPEN_KEY = 'canix_menu_closed';

function readClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * The portal menu: a module switcher (only for people who have more than one module) and the
 * sections of the current module, in groups that fold away. Everything shown is decided by the
 * person's permissions upstream (visibleSections); this only lays it out.
 */
export function Sidebar({
  sections,
  modules,
  module,
  onModule,
  active,
  onNavigate,
  badges,
  context,
  open,
  onClose,
}: {
  sections: SectionDef[];
  modules: ModuleDef[];
  module: ModuleId;
  onModule: (id: ModuleId) => void;
  active: string;
  onNavigate: (id: string) => void;
  /** Counters shown next to a section (orders waiting, chats waiting…). */
  badges: Record<string, number>;
  /** Extra block under the switcher, e.g. which business is being managed. */
  context?: React.ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const { logout, user } = useAuth();
  const items = sections.filter((s) => s.module === module && !s.hidden);
  const groups = [...new Set(items.map((s) => s.group))];
  const [closed, setClosed] = useState<string[]>(readClosed);
  const current = MODULES.find((m) => m.id === module);
  const subtitle = modules.length > 1 ? (current?.hint ?? 'Canix') : module === 'business' ? 'Asistente de tu negocio' : user?.role === 'admin' ? 'Panel de administración' : 'Tu asistente personal';

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(closed));
    } catch {
      /* private mode: folding just won't be remembered */
    }
  }, [closed]);

  const toggle = (g: string) => setClosed((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g]));
  const moduleBadge = (m: ModuleId) => sections.filter((s) => s.module === m).reduce((n, s) => n + (badges[s.id] ?? 0), 0);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm animate-fade-in lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-gray-medium/60 bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:border-white/10 dark:bg-[#10143a]/95 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Logo size={42} subtitle={subtitle} />
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-dark hover:bg-gray-medium/60 lg:hidden" aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        {modules.length > 1 && (
          <div role="tablist" aria-label="Módulos" className="mx-3 mb-2 grid gap-1 rounded-2xl bg-gray-light p-1 dark:bg-white/5" style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }}>
            {modules.map((m) => {
              const selected = m.id === module;
              const count = selected ? 0 : moduleBadge(m.id);
              return (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onModule(m.id)}
                  className={`relative flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-bold transition-[background-color,color,box-shadow] duration-150 ease-out active:scale-[0.97] ${
                    selected ? 'bg-white text-primary-dark shadow-sm dark:bg-white/15 dark:text-white' : 'text-gray-dark hover:text-ink dark:hover:text-white'
                  }`}
                >
                  <m.icon size={16} strokeWidth={2.2} />
                  {m.label}
                  {count > 0 && <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-error ring-2 ring-gray-light dark:ring-[#10143a]" aria-label="Pendientes" />}
                </button>
              );
            })}
          </div>
        )}

        {context && <div className="px-3 pb-2">{context}</div>}

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 pt-1">
          {groups.map((g) => {
            const rows = items.filter((s) => s.group === g);
            // Folding is for long groups; the one holding the current page is always open.
            const foldable = groups.length > 1 && rows.length > 1;
            const isOpen = !foldable || !closed.includes(g) || rows.some((s) => s.id === active);
            return (
              <div key={g}>
                {groups.length > 1 && (
                  <button
                    onClick={() => foldable && toggle(g)}
                    aria-expanded={isOpen}
                    className={`mb-0.5 mt-2 flex w-full items-center justify-between rounded-lg px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-dark/70 ${foldable ? 'hover:text-ink dark:hover:text-white' : 'cursor-default'}`}
                  >
                    {g}
                    {foldable && <ChevronDown size={14} className={`transition-transform duration-200 ease-out ${isOpen ? '' : '-rotate-90'}`} aria-hidden />}
                  </button>
                )}
                <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="space-y-0.5 overflow-hidden">
                    {rows.map(({ id, label, icon: Icon }) => {
                      const isActive = active === id;
                      const count = badges[id] ?? 0;
                      return (
                        <button
                          key={id}
                          tabIndex={isOpen ? 0 : -1}
                          onClick={() => onNavigate(id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
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
                          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                          {count > 0 && <span className="min-w-5 rounded-full bg-error px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white tabular-nums">{count > 99 ? '99+' : count}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="m-3 rounded-2xl border border-gray-medium/60 bg-gray-light/80 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('account')} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left" title="Mi cuenta">
              <Avatar name={user?.name ?? null} seed={user?.id ?? 0} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink dark:text-white">{user?.name ?? 'Tu cuenta'}</span>
                <span className="block truncate text-xs text-gray-dark">{user?.role === 'admin' ? 'Administrador' : user?.phoneKnown === false ? 'Número por confirmar' : `+${user?.phone ?? ''}`}</span>
              </span>
            </button>
            <button onClick={logout} className="rounded-lg p-2 text-gray-dark hover:bg-white hover:text-error dark:hover:bg-white/10" aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
