import type { HTMLAttributes } from 'react';

export function Card({ className = '', interactive, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)] ${
        interactive ? 'cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift' : ''
      } ${className}`}
      {...props}
    />
  );
}
