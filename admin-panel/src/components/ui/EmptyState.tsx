import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-medium py-16 text-center dark:border-white/10">
      {icon && <div className="text-4xl">{icon}</div>}
      <p className="font-display text-lg font-semibold text-ink dark:text-white/90">{title}</p>
      {description && <p className="max-w-sm text-sm text-gray-dark">{description}</p>}
      {action}
    </div>
  );
}
