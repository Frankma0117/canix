import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'brand-gradient text-white shadow-[0_8px_20px_-8px_rgba(75,92,246,0.7)] hover:brightness-110 hover:shadow-[0_10px_26px_-8px_rgba(91,76,245,0.8)] disabled:opacity-50',
  secondary:
    'bg-white text-ink border border-gray-medium hover:border-primary/50 hover:text-primary-dark hover:bg-secondary/60 disabled:opacity-50 dark:bg-white/5 dark:text-white dark:border-white/10 dark:hover:bg-white/10',
  ghost: 'bg-transparent text-gray-dark hover:bg-gray-medium/60 hover:text-ink disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white',
  danger: 'bg-error text-white hover:bg-red-600 shadow-[0_8px_20px_-10px_rgba(239,68,68,0.8)] disabled:opacity-50',
  soft: 'bg-secondary text-primary-dark hover:bg-primary/15 disabled:opacity-50 dark:bg-primary/15 dark:text-white dark:hover:bg-primary/25',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm rounded-xl gap-2',
  lg: 'px-5 py-3 text-base rounded-2xl gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={size === 'sm' ? 13 : 16} className="animate-spin" />}
      {children}
    </button>
  );
}

/** Square icon-only button with an accessible label (shown as tooltip). */
export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-gray-dark transition-colors hover:bg-gray-medium/60 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 dark:hover:bg-white/10 dark:hover:text-white ${className}`}
      {...props}
    />
  );
}
