import type { ReactNode } from 'react';
import { Sticker, type StickerName } from '../brand/Sticker.tsx';

export function EmptyState({
  icon,
  sticker,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  /** One of the mascot stickers - preferred over `icon` for a friendlier empty screen. */
  sticker?: StickerName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="soft-gradient relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border border-dashed border-primary/20 px-6 py-12 text-center animate-fade-in dark:border-white/10">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative flex flex-col items-center gap-3">
        {sticker ? <Sticker name={sticker} size={132} float /> : icon && <div className="text-4xl">{icon}</div>}
        <p className="font-display text-xl font-extrabold text-ink dark:text-white">{title}</p>
        {description && <p className="max-w-sm text-sm text-gray-dark">{description}</p>}
        {action}
      </div>
    </div>
  );
}
