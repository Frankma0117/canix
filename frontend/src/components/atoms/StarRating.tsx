import { Star } from 'lucide-react';

/** 1-5 stars. Read-only without `onChange`; clicking the current value again clears it. */
export function StarRating({ value, onChange, size = 15 }: { value: number | null; onChange?: (value: number | null) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value ? `${value} de 5` : 'Sin calificar'}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = !!value && n <= value;
        const star = <Star size={size} className={filled ? 'fill-amber-400 text-amber-400' : 'text-gray-medium dark:text-white/20'} />;
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(value === n ? null : n)} className="rounded p-0.5 hover:scale-110" aria-label={`${n} estrellas`}>
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        );
      })}
    </span>
  );
}
