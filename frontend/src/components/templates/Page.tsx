import type { ReactNode } from 'react';
import { Sticker, type StickerName } from '../atoms/Sticker.tsx';

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
