
export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-all ${
        active
          ? 'bg-primary text-white ring-primary'
          : 'bg-white text-gray-dark ring-gray-medium hover:text-ink hover:ring-primary/40 dark:bg-white/5 dark:ring-white/10 dark:hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Edit a garment
// ---------------------------------------------------------------------------------------------
