import { Check, X } from 'lucide-react';
import { IconButton } from '../../atoms/Button.tsx';
import { Item } from '../../../config/lists.ts';

/** One row of a list: a big tap target that checks/unchecks it, with remove on the side. */
export function ItemRow({ item, onToggle, onRemove }: { item: Item; onToggle: () => void; onRemove: () => void }) {
  const checked = !!item.checked;
  return (
    <li className="group flex items-start gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-gray-light focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 dark:hover:bg-white/5"
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
            checked ? 'border-success bg-success text-white' : 'border-gray-medium bg-white dark:border-white/25 dark:bg-transparent'
          }`}
          aria-hidden
        >
          {checked && <Check size={14} strokeWidth={3} />}
        </span>
        <span className={`min-w-0 text-sm leading-snug ${checked ? 'text-gray-dark line-through' : 'text-ink dark:text-white/90'}`}>{item.title}</span>
      </button>
      <IconButton
        label={`Quitar "${item.title}"`}
        onClick={onRemove}
        className="mt-0.5 h-8 w-8 shrink-0 opacity-0 hover:!bg-error/10 hover:!text-error focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={15} />
      </IconButton>
    </li>
  );
}
