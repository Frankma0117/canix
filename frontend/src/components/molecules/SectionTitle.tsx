import type { ReactNode } from 'react';

/** Section title inside a page. */
export function SectionTitle({ children, action, hint }: { children: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2 first:mt-0">
      <div>
        <h2 className="font-display text-lg font-extrabold text-ink dark:text-white">{children}</h2>
        {hint && <p className="text-xs text-gray-dark">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
