import type { ReactNode } from 'react';

const STAT_TONES = {
  brand: 'from-[#2f8bff] to-[#5b4cf5]',
  violet: 'from-[#7c5cff] to-[#b04cf0]',
  cyan: 'from-[#1fc8e3] to-[#2f8bff]',
  amber: 'from-[#ffb020] to-[#ff7a1a]',
  green: 'from-[#19c58f] to-[#12a4b8]',
} as const;

/** Metric tile for dashboards. */
export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'brand',
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof STAT_TONES;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="group relative flex flex-col items-start justify-start overflow-hidden rounded-2xl border border-gray-medium/70 bg-white p-4 text-left shadow-soft transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-lift disabled:cursor-default dark:border-white/10 dark:bg-[var(--surface)]"
    >
      <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${STAT_TONES[tone]}`}>{icon}</div>
      <p className="font-display text-3xl font-black leading-none text-ink dark:text-white">{value}</p>
      <p className="mt-1.5 text-sm font-semibold text-ink/80 dark:text-white/80">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-dark">{hint}</p>}
    </button>
  );
}
