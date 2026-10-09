import { Menu, Moon, Sun, MonitorSmartphone, MessageCircle } from 'lucide-react';
import { useTheme, type Theme } from '../lib/theme.ts';
import type { SectionDef } from '../lib/sections.tsx';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: oscuro' };

export function Topbar({ current, onMenu }: { current?: SectionDef; onMenu: () => void }) {
  const [theme, setTheme] = useTheme();
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : MonitorSmartphone;

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-medium/60 bg-white/80 px-4 py-2.5 backdrop-blur-xl sm:px-8 dark:border-white/10 dark:bg-[#0b0e24]/80">
      <button onClick={onMenu} className="rounded-xl p-2 text-ink hover:bg-gray-medium/60 lg:hidden dark:text-white dark:hover:bg-white/10" aria-label="Abrir menú">
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-gray-dark">{current?.group ?? 'Canix'}</p>
        <p className="truncate font-display text-base font-extrabold leading-tight text-ink dark:text-white">{current?.label ?? 'Inicio'}</p>
      </div>
      <span className="hidden items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-emerald-700 md:inline-flex dark:text-emerald-300">
        <MessageCircle size={13} /> También puedes pedírmelo por WhatsApp
      </span>
      <button
        onClick={() => setTheme(NEXT[theme])}
        className="rounded-xl p-2 text-gray-dark hover:bg-gray-medium/60 hover:text-ink dark:hover:bg-white/10 dark:hover:text-white"
        aria-label={THEME_LABEL[theme]}
        title={THEME_LABEL[theme]}
      >
        <ThemeIcon size={18} />
      </button>
    </header>
  );
}
