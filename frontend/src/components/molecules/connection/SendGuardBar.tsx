
export function SendGuardBar({ label, used, cap, className }: { label: string; used: number; cap: number; className?: string }) {
  const unlimited = cap < 0; // -1 sentinel for "uncapped" (see send-guard.ts's capForWire)
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  const tone = unlimited ? 'bg-primary' : pct >= 90 ? 'bg-error' : pct >= 60 ? 'bg-warning' : 'bg-primary';
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-dark">
        <span>{label}</span>
        <span>{unlimited ? `${used} / sin límite` : `${used} / ${cap}`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-medium/40">
        {!unlimited && <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}
