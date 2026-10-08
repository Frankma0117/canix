import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

/** Closes on Escape - shared by Modal and Drawer. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Modal({
  title,
  description,
  onClose,
  children,
  size = 'sm',
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof SIZES;
}) {
  useEscape(onClose);
  // Portaled to <body>: pages animate in with a transform, and a transformed ancestor would
  // otherwise trap this "fixed" overlay inside the page area (sidebar/topbar left uncovered).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[94vh] w-full ${SIZES[size]} overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl shadow-navy/20 animate-pop-in sm:rounded-3xl dark:bg-[#1a1f45]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-extrabold text-ink dark:text-white">{title}</h3>
            {description && <p className="mt-1 text-sm text-gray-dark">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 text-gray-dark hover:bg-gray-medium/60 dark:hover:bg-white/10" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Right-side panel for rich detail views (e.g. a person's full profile in Administración). */
export function Drawer({
  title,
  subtitle,
  header,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  header?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscape(onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-navy/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-2xl flex-col bg-gray-light shadow-2xl animate-slide-in-right dark:bg-[#0f1330]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative overflow-hidden border-b border-gray-medium/70 bg-white px-6 pb-5 pt-6 dark:border-white/10 dark:bg-[var(--surface)]">
          <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {header}
              <h2 className="font-display text-2xl font-black text-ink dark:text-white">{title}</h2>
              {subtitle && <div className="mt-1 text-sm text-gray-dark">{subtitle}</div>}
            </div>
            <button onClick={onClose} className="rounded-xl p-2 text-gray-dark hover:bg-gray-medium/60 dark:hover:bg-white/10" aria-label="Cerrar">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-gray-medium/70 bg-white px-6 py-4 dark:border-white/10 dark:bg-[var(--surface)]">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
