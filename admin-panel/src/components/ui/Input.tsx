import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const FIELD =
  'w-full rounded-xl border border-gray-medium bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-all placeholder:text-gray-dark/60 hover:border-primary/30 focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20';

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="mb-1.5 block text-sm font-semibold text-ink dark:text-white/85" {...props} />;
}

export function Input({ icon, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  if (!icon) return <input className={`${FIELD} ${className}`} {...props} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-dark">{icon}</span>
      <input className={`${FIELD} pl-10 ${className}`} {...props} />
    </div>
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD} cursor-pointer ${className}`} {...props} />;
}

/** Small helper text under a field. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs text-gray-dark">{children}</p>;
}
