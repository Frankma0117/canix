import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'canix_theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Applies the saved theme before React renders (called from main.tsx - no inline script, CSP). */
export function initTheme() {
  apply(read());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => read() === 'system' && apply('system'));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* private mode - the theme still applies for this visit */
    }
  }, [theme]);
  return [theme, setTheme];
}
