import type { ReactNode } from 'react';

/** Standard page frame: title row (with optional actions), optional intro, content. */
export function Page({
  title,
  description,
  actions,
  wide,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-3xl'} p-4 sm:p-8`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <div className="mb-5 text-sm text-gray-dark">{description}</div>}
      {children}
    </div>
  );
}

/** Inline error/success banner. */
export function Notice({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const cls = { error: 'bg-error/10 text-error', success: 'bg-success/10 text-success', info: 'bg-info/10 text-info' }[tone];
  return <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

/** Simple tab strip. */
export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { id: T; label: ReactNode }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-gray-medium/50 p-1 dark:bg-white/5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            active === t.id ? 'bg-white text-ink shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-dark hover:text-ink dark:hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
