import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

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
