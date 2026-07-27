import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-gray-medium/70 bg-white shadow-sm shadow-black/[0.03] dark:border-white/10 dark:bg-white/5 ${className}`}
      {...props}
    />
  );
}
