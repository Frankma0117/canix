import type { PermissionDef } from '../../lib/types.ts';

export function groupByModule(perms: PermissionDef[]): [string, PermissionDef[]][] {
  const map = new Map<string, PermissionDef[]>();
  for (const p of perms) map.set(p.module, [...(map.get(p.module) ?? []), p]);
  return [...map];
}

function PaidBadge() {
  return <span className="ml-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning">De pago</span>;
}

/** Plain checkboxes - used by the package editor. Paid extras never go in a package (the server
 *  rejects it too), so they're left out here and only assigned per person on the Users page. */
export function PermissionChecklist({ catalog, selected, onChange }: { catalog: PermissionDef[]; selected: string[]; onChange: (keys: string[]) => void }) {
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const hasPaid = catalog.some((p) => p.billable);
  return (
    <div className="space-y-3">
      {hasPaid && (
        <p className="text-xs text-gray-dark">Los extras de pago (llamadas, voz natural) no van en paquetes: se habilitan persona por persona en Usuarios.</p>
      )}
      {groupByModule(catalog.filter((p) => !p.billable)).map(([module, perms]) => (
        <div key={module}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-dark">{module}</p>
          <div className="space-y-1">
            {perms.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-gray-light dark:hover:bg-white/5">
                <input type="checkbox" className="mt-0.5" checked={selected.includes(p.key)} onChange={() => toggle(p.key)} />
                <span>
                  <span className="text-sm font-medium text-ink dark:text-white">{p.label}</span>
                  <span className="block text-xs text-gray-dark">{p.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export type Override = 'inherit' | 'allow' | 'deny';

/**
 * Per-permission tri-state for one user: inherit (whatever their packages say), allow, deny.
 * Shows what the packages already give so the admin sees the effect of each choice.
 */
export function PermissionOverrides({
  catalog,
  fromPackages,
  value,
  onChange,
}: {
  catalog: PermissionDef[];
  fromPackages: Set<string>;
  value: Record<string, Override>;
  onChange: (v: Record<string, Override>) => void;
}) {
  return (
    <div className="space-y-3">
      {groupByModule(catalog).map(([module, perms]) => (
        <div key={module}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-dark">{module}</p>
          <div className="divide-y divide-gray-medium/60 rounded-xl border border-gray-medium/70 dark:divide-white/10 dark:border-white/10">
            {perms.map((p) => {
              const v = value[p.key] ?? 'inherit';
              const effective = v === 'allow' || (v === 'inherit' && fromPackages.has(p.key));
              return (
                <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink dark:text-white">
                      {p.label}
                      {p.billable && <PaidBadge />}{' '}
                      <span className={`ml-1 text-xs ${effective ? 'text-success' : 'text-gray-dark'}`}>{effective ? '● activo' : '○ inactivo'}</span>
                    </p>
                    <p className="text-xs text-gray-dark">{fromPackages.has(p.key) ? 'Incluido por un paquete' : 'No viene en sus paquetes'}</p>
                  </div>
                  <div className="flex overflow-hidden rounded-lg border border-gray-medium text-xs dark:border-white/10">
                    {(['inherit', 'allow', 'deny'] as Override[]).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => onChange({ ...value, [p.key]: opt })}
                        className={`px-2.5 py-1 ${
                          v === opt
                            ? opt === 'deny'
                              ? 'bg-error text-white'
                              : opt === 'allow'
                                ? 'bg-success text-white'
                                : 'bg-gray-medium text-ink dark:bg-white/20 dark:text-white'
                            : 'text-gray-dark hover:bg-gray-light dark:hover:bg-white/5'
                        }`}
                      >
                        {opt === 'inherit' ? 'Según paquete' : opt === 'allow' ? 'Permitir' : 'Denegar'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
