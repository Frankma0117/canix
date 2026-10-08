import { Check, Minus, Package as PackageIcon, Sparkles } from 'lucide-react';
import type { PermissionDef, PermissionPackage } from '../../lib/types.ts';
import { groupByModule } from '../../lib/admin.ts';
import { Badge } from '../../components/ui/Badge.tsx';

export { groupByModule };

export function PaidBadge() {
  return (
    <Badge tone="premium">
      <Sparkles size={11} /> De pago
    </Badge>
  );
}

/** Plain checkboxes - used by the package editor. Paid extras never go in a package (the server
 *  rejects it too), so they're left out here and only assigned per person. */
export function PermissionChecklist({ catalog, selected, onChange }: { catalog: PermissionDef[]; selected: string[]; onChange: (keys: string[]) => void }) {
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const hasPaid = catalog.some((p) => p.billable);
  return (
    <div className="space-y-4">
      {hasPaid && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          Los extras de pago (llamadas, voz natural) no van en paquetes: se habilitan persona por persona.
        </p>
      )}
      {groupByModule(catalog.filter((p) => !p.billable)).map(([module, perms]) => (
        <div key={module}>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-dark">{module}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {perms.map((p) => {
              const on = selected.includes(p.key);
              return (
                <button
                  type="button"
                  key={p.key}
                  onClick={() => toggle(p.key)}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${
                    on ? 'border-primary/50 bg-primary/5 dark:bg-primary/15' : 'border-gray-medium/70 hover:border-primary/30 dark:border-white/10'
                  }`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${on ? 'brand-gradient text-white' : 'border border-gray-medium dark:border-white/20'}`}>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink dark:text-white">{p.label}</span>
                    <span className="block text-xs text-gray-dark">{p.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export type Override = 'inherit' | 'allow' | 'deny';

/** Three-way switch: según paquete / permitir / denegar. */
export function TriState({ value, onChange, inheritLabel = 'Paquete' }: { value: Override; onChange: (v: Override) => void; inheritLabel?: string }) {
  const opts: { v: Override; label: string; cls: string }[] = [
    { v: 'inherit', label: inheritLabel, cls: 'bg-white text-ink shadow-sm dark:bg-white/15 dark:text-white' },
    { v: 'allow', label: 'Permitir', cls: 'bg-success text-white shadow-sm' },
    { v: 'deny', label: 'Denegar', cls: 'bg-error text-white shadow-sm' },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-xl bg-gray-medium/60 p-0.5 text-xs font-semibold dark:bg-white/5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-lg px-2.5 py-1 transition-all ${value === o.v ? o.cls : 'text-gray-dark hover:text-ink dark:hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Full per-person access editor: packages on top, then every permission (paid extras first, in
 * their own highlighted block) with its tri-state and a live "has it / why" indicator.
 */
export function AccessEditor({
  catalog,
  packages,
  pkgIds,
  onPkgIds,
  overrides,
  onOverrides,
}: {
  catalog: PermissionDef[];
  packages: PermissionPackage[];
  pkgIds: number[];
  onPkgIds: (ids: number[]) => void;
  overrides: Record<string, Override>;
  onOverrides: (o: Record<string, Override>) => void;
}) {
  const fromPackages = new Set(packages.filter((p) => pkgIds.includes(p.id)).flatMap((p) => p.permissions));
  const paid = catalog.filter((p) => p.billable);
  const regular = catalog.filter((p) => !p.billable);

  const row = (p: PermissionDef) => {
    const v = overrides[p.key] ?? 'inherit';
    const effective = v === 'allow' || (v === 'inherit' && fromPackages.has(p.key));
    const why = v === 'allow' ? 'Permitido directamente' : v === 'deny' ? 'Denegado directamente' : fromPackages.has(p.key) ? 'Incluido por un paquete' : p.billable ? 'Se habilita aquí, persona por persona' : 'No viene en sus paquetes';
    return (
      <div key={p.key} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${effective ? 'bg-success/15 text-success' : 'bg-gray-medium/70 text-gray-dark dark:bg-white/10'}`}>
            {effective ? <Check size={12} strokeWidth={3} /> : <Minus size={12} strokeWidth={3} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink dark:text-white">{p.label}</p>
            <p className="text-xs text-gray-dark">{p.description}</p>
            <p className={`mt-0.5 text-[11px] font-semibold ${effective ? 'text-success' : 'text-gray-dark'}`}>{why}</p>
          </div>
        </div>
        <TriState value={v} onChange={(nv) => onOverrides({ ...overrides, [p.key]: nv })} inheritLabel={p.billable ? 'No' : 'Paquete'} />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
          <PackageIcon size={16} className="text-primary" /> Paquetes
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {packages.map((p) => {
            const on = pkgIds.includes(p.id);
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => onPkgIds(on ? pkgIds.filter((x) => x !== p.id) : [...pkgIds, p.id])}
                className={`rounded-2xl border p-3 text-left transition-all ${
                  on ? 'border-primary/60 bg-gradient-to-br from-primary/8 to-accent/8 shadow-sm dark:from-primary/20 dark:to-accent/15' : 'border-gray-medium/70 bg-white hover:border-primary/30 dark:border-white/10 dark:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink dark:text-white">{p.name}</span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-md ${on ? 'brand-gradient text-white' : 'border border-gray-medium dark:border-white/20'}`}>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-dark">{p.description}</p>
                <p className="mt-1.5 text-[11px] font-semibold text-primary">{p.permissions.length} funciones</p>
              </button>
            );
          })}
        </div>
      </div>

      {paid.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
            <Sparkles size={16} className="text-amber-500" /> Extras de pago <PaidBadge />
          </p>
          <div className="divide-y divide-amber-200/70 overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-br from-amber-50/80 to-orange-50/60 dark:divide-amber-400/10 dark:border-amber-400/20 dark:from-amber-500/5 dark:to-orange-500/5">
            {paid.map(row)}
          </div>
        </div>
      )}

      {groupByModule(regular).map(([module, perms]) => (
        <div key={module}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-dark">{module}</p>
          <div className="divide-y divide-gray-medium/60 overflow-hidden rounded-2xl border border-gray-medium/70 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-white/5">{perms.map(row)}</div>
        </div>
      ))}
    </div>
  );
}
