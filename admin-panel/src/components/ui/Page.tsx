import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { Sticker, type StickerName } from '../brand/Sticker.tsx';

/**
 * Standard page frame: a header band (eyebrow, title, description, optional mascot sticker and
 * actions) followed by the content. Every portal section uses it, so they all look like one product.
 */
export function Page({
  title,
  description,
  actions,
  wide,
  eyebrow,
  sticker,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  eyebrow?: string;
  sticker?: StickerName;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-4xl'} px-4 pb-16 pt-5 sm:px-8 sm:pt-8 animate-fade-in`}>
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-gray-medium/60 bg-white px-5 py-5 shadow-soft sm:px-7 sm:py-6 dark:border-white/10 dark:bg-[var(--surface)]">
        <div className="soft-gradient pointer-events-none absolute inset-y-0 right-0 w-2/3 opacity-80 [mask-image:linear-gradient(to_left,black,transparent)]" />
        <div className="dot-grid pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60 [mask-image:linear-gradient(to_left,black,transparent)]" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>}
            <h1 className="font-display text-2xl font-black text-ink sm:text-3xl dark:text-white">{title}</h1>
            {description && <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-dark">{description}</div>}
            {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {sticker && <Sticker name={sticker} size={104} className="hidden shrink-0 sm:block" />}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Inline error/success/info banner. */
export function Notice({ tone, children }: { tone: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const cls = {
    error: 'bg-error/10 text-red-700 ring-error/20 dark:text-red-300',
    success: 'bg-success/10 text-emerald-700 ring-success/20 dark:text-emerald-300',
    info: 'bg-info/10 text-blue-700 ring-info/20 dark:text-blue-300',
    warning: 'bg-warning/10 text-amber-800 ring-warning/30 dark:text-amber-200',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={`mb-4 flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm ring-1 ring-inset animate-fade-in ${cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

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

const AVATAR_GRADIENTS = [
  'from-[#2f8bff] to-[#5b4cf5]',
  'from-[#7c5cff] to-[#b04cf0]',
  'from-[#1fc8e3] to-[#2f8bff]',
  'from-[#ff7ab6] to-[#8b5cf6]',
  'from-[#19c58f] to-[#12a4b8]',
  'from-[#ffb020] to-[#ff5f6d]',
];

/** Initials avatar with a stable per-person gradient. */
export function Avatar({ name, seed, size = 40 }: { name: string | null; seed: number; size?: number }) {
  const initials =
    (name ?? '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-display font-black text-white shadow-sm ${AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
