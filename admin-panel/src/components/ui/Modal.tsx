import type { ReactNode } from 'react';

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

export function Modal({
  title,
  onClose,
  children,
  size = 'sm',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof SIZES;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`max-h-[92vh] w-full ${SIZES[size]} overflow-y-auto rounded-2xl bg-white p-6 shadow-xl shadow-black/10 dark:bg-[#1c1d3a]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-ink dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-dark hover:bg-gray-medium/60 dark:hover:bg-white/10"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
