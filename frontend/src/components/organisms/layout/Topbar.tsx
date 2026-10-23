import { useState } from 'react';
import { Menu, Moon, Sun, MonitorSmartphone, MessageCircle, FlaskConical } from 'lucide-react';
import { useTheme, type Theme } from '../../../utils/theme.ts';
import { useAuth } from '../../../services/auth.tsx';
import { useApi } from '../../../services/api.ts';
import type { SectionDef } from '../../../config/sections.tsx';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: oscuro' };

/**
 * Shown on every screen while the administrator is in "modo prueba", so it can't be forgotten:
 * the bot on WhatsApp is answering with reduced access even though this portal looks complete.
 */
function TestModeBanner() {
  const { user, refresh } = useAuth();
  const api = useApi();
  const [leaving, setLeaving] = useState(false);
  if (!user?.testMode) return null;

  async function leave() {
    setLeaving(true);
    try {
      await api.del('/api/admin/test-mode');
      await refresh();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-8 dark:bg-amber-500/15 dark:text-amber-100">
      <FlaskConical size={16} className="shrink-0" />
      <p className="min-w-0 flex-1">
        <strong>Modo prueba activo: {user.testMode.label}.</strong> En WhatsApp Canix te responde solo con esas funciones; este portal sigue completo.
      </p>
      <button
        onClick={leave}
        disabled={leaving}
        className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-200 dark:text-amber-950"
      >
        {leaving ? 'Saliendo…' : 'Salir del modo prueba'}
      </button>
    </div>
  );
}

export function Topbar({ current, onMenu }: { current?: SectionDef; onMenu: () => void }) {
  const [theme, setTheme] = useTheme();
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : MonitorSmartphone;

  return (
    <div className="sticky top-0 z-30">
      <TestModeBanner />
      <header className="flex items-center gap-3 border-b border-gray-medium/60 bg-white/80 px-4 py-2.5 backdrop-blur-xl sm:px-8 dark:border-white/10 dark:bg-[#0b0e24]/80">
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
    </div>
  );
}
