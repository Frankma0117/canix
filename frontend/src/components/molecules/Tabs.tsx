import type { ReactNode } from 'react';

/** Tab strip (segmented control look). */
export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-gray-medium/50 p-1 dark:bg-white/5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-all ${
            active === t.id ? 'bg-white text-ink shadow-sm dark:bg-white/15 dark:text-white' : 'text-gray-dark hover:text-ink dark:hover:text-white'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`rounded-full px-1.5 text-[11px] ${active === t.id ? 'bg-primary/10 text-primary-dark dark:text-white' : 'bg-gray-medium dark:bg-white/10'}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
