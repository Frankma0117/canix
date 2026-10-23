import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand' | 'violet' | 'cyan' | 'premium';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-success/10 text-emerald-700 ring-success/20 dark:text-emerald-300',
  warning: 'bg-warning/12 text-amber-700 ring-warning/25 dark:text-amber-300',
  error: 'bg-error/10 text-red-700 ring-error/20 dark:text-red-300',
  info: 'bg-info/10 text-blue-700 ring-info/20 dark:text-blue-300',
  neutral: 'bg-gray-medium/60 text-gray-dark ring-gray-medium dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  brand: 'bg-primary/10 text-primary-dark ring-primary/20 dark:text-indigo-200',
  violet: 'bg-accent/10 text-violet-700 ring-accent/20 dark:text-violet-200',
  cyan: 'bg-cyan/15 text-cyan-800 ring-cyan/30 dark:text-cyan-200',
  premium: 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 ring-amber-300/60 dark:from-amber-500/15 dark:to-orange-500/15 dark:text-amber-200',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}
