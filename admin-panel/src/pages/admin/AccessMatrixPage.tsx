import { Fragment, useMemo, useState } from 'react';
import { Check, X, Minus, Search, Sparkles, Loader2, Info } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { AdminUser, PermissionDef } from '../../lib/types.ts';
import { useAdminData, permissionSource, hasPermission, groupByModule, type PermissionSource } from '../../lib/admin.ts';
import { Page, Notice, Avatar } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Input, Select } from '../../components/ui/Input.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { UserDrawer } from './UserDrawer.tsx';

/** Click cycle of one cell: según paquete -> permitir -> denegar -> según paquete. */
function nextEffect(user: AdminUser, key: string): 'allow' | 'deny' | null {
  if (user.allow.includes(key)) return 'deny';
  if (user.deny.includes(key)) return null;
  return 'allow';
}

const CELL: Record<PermissionSource, { cls: string; title: string }> = {
  admin: { cls: 'bg-primary/10 text-primary', title: 'Administrador: acceso total' },
  package: { cls: 'bg-success/12 text-success ring-1 ring-inset ring-success/25', title: 'Lo tiene por un paquete' },
  allow: { cls: 'bg-success text-white shadow-sm shadow-success/30', title: 'Permitido directamente' },
  deny: { cls: 'bg-error text-white shadow-sm shadow-error/30', title: 'Denegado directamente' },
  none: { cls: 'bg-gray-medium/50 text-gray-dark/60 dark:bg-white/5', title: 'No lo tiene' },
};

export function AccessMatrixPage() {
  const api = useApi();
  const toast = useToast();
  const { users, catalog, packages, error, reload, replaceUser } = useAdminData();
  const [q, setQ] = useState('');
  const [module, setModule] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const modules = groupByModule(catalog).map(([m]) => m);
  const columns: [string, PermissionDef[]][] = useMemo(() => groupByModule(catalog).filter(([m]) => module === 'all' || m === module), [catalog, module]);
  const flatCols = columns.flatMap(([, ps]) => ps);
  const rows = (users ?? [])
    .filter((u) => !q.trim() || (u.name ?? '').toLowerCase().includes(q.trim().toLowerCase()) || (u.phone ?? u.whatsapp_id).includes(q.replace(/\D/g, '') || '§'))
    .sort((a, b) => (a.role === 'admin' ? -1 : b.role === 'admin' ? 1 : (a.name ?? '').localeCompare(b.name ?? '')));

  async function toggle(user: AdminUser, p: PermissionDef) {
    if (user.role === 'admin') return toast.error('El administrador siempre tiene acceso total.');
    const cell = `${user.id}:${p.key}`;
    const effect = nextEffect(user, p.key);
    setBusy(cell);
    try {
      replaceUser(await api.put<AdminUser>(`/api/admin/users/${user.id}/permissions/${p.key}`, { effect }));
      toast.success(`${p.label} para ${user.name ?? 'esta persona'}: ${effect === 'allow' ? 'permitido' : effect === 'deny' ? 'denegado' : 'según su paquete'}.`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const open = (users ?? []).find((u) => u.id === openId) ?? null;

  return (
    <Page
      eyebrow="Administración"
      title="Matriz de acceso"
      sticker="revisando"
      wide
      description="Todas las personas y todas las funciones en una sola vista. Toca una celda para cambiarla: según paquete → permitir → denegar. Se guarda al instante."
    >
      {error && <Notice tone="error">{error}</Notice>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <Input icon={<Search size={16} />} placeholder="Filtrar personas…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-56">
          <Select value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="all">Todas las funciones</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-gray-dark">
        <Info size={14} />
        {(['package', 'allow', 'deny', 'none'] as PermissionSource[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`flex h-5 w-5 items-center justify-center rounded-md ${CELL[s].cls}`}>
              {s === 'deny' ? <X size={12} strokeWidth={3} /> : s === 'none' ? <Minus size={12} /> : <Check size={12} strokeWidth={3} />}
            </span>
            {CELL[s].title}
          </span>
        ))}
      </div>

      {!users ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r border-gray-medium/70 bg-white px-4 py-2 text-left dark:border-white/10 dark:bg-[#151a3a]" rowSpan={2}>
                    <span className="font-display text-sm font-extrabold text-ink dark:text-white">Persona</span>
                  </th>
                  {columns.map(([m, ps]) => (
                    <th
                      key={m}
                      colSpan={ps.length}
                      className="sticky top-0 z-20 border-b border-l border-gray-medium/70 bg-gray-light px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em] text-gray-dark dark:border-white/10 dark:bg-[#121636]"
                    >
                      {m}
                    </th>
                  ))}
                </tr>
                <tr>
                  {columns.map(([m, ps]) => (
                    <Fragment key={m}>
                      {ps.map((p, i) => {
                        const have = rows.filter((u) => hasPermission(permissionSource(u, p.key, packages))).length;
                        return (
                          <th
                            key={p.key}
                            title={p.description}
                            className={`sticky top-[29px] z-20 w-24 border-b border-gray-medium/70 bg-white px-1.5 py-2 align-bottom dark:border-white/10 dark:bg-[#151a3a] ${i === 0 ? 'border-l' : ''}`}
                          >
                            <span className="line-clamp-2 block text-center text-[11px] font-bold leading-tight text-ink dark:text-white">
                              {p.billable && <Sparkles size={10} className="mr-0.5 inline text-amber-500" />}
                              {p.label}
                            </span>
                            <span className="mt-0.5 block text-center text-[10px] font-semibold text-gray-dark">
                              {have}/{rows.length}
                            </span>
                          </th>
                        );
                      })}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="group">
                    <td className="sticky left-0 z-10 border-b border-r border-gray-medium/60 bg-white px-3 py-2 group-hover:bg-secondary/60 dark:border-white/10 dark:bg-[#151a3a] dark:group-hover:bg-[#1c2250]">
                      <button className="flex items-center gap-2.5 text-left" onClick={() => setOpenId(u.id)}>
                        <Avatar name={u.name} seed={u.id} size={32} />
                        <span className="min-w-0">
                          <span className="block max-w-40 truncate text-sm font-bold text-ink hover:text-primary dark:text-white">{u.name ?? '(sin nombre)'}</span>
                          <span className="block text-[11px] text-gray-dark">{u.role === 'admin' ? 'Administrador' : `${u.effective.length} funciones`}</span>
                        </span>
                      </button>
                    </td>
                    {flatCols.map((p, i) => {
                      const src = permissionSource(u, p.key, packages);
                      const cell = `${u.id}:${p.key}`;
                      const firstOfGroup = columns.some(([, ps]) => ps[0]?.key === p.key) && i > 0;
                      return (
                        <td key={p.key} className={`border-b border-gray-medium/60 px-1 py-1.5 text-center group-hover:bg-secondary/40 dark:border-white/10 dark:group-hover:bg-white/[0.03] ${firstOfGroup || i === 0 ? 'border-l' : ''}`}>
                          <button
                            onClick={() => toggle(u, p)}
                            disabled={busy === cell}
                            title={`${p.label}: ${CELL[src].title}${u.role === 'admin' ? '' : ' - toca para cambiar'}`}
                            className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:scale-110 active:scale-95 ${CELL[src].cls} ${u.role === 'admin' ? 'cursor-default hover:scale-100' : ''}`}
                          >
                            {busy === cell ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : src === 'deny' ? (
                              <X size={14} strokeWidth={3} />
                            ) : src === 'none' ? (
                              <Minus size={14} />
                            ) : (
                              <Check size={14} strokeWidth={3} />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {open && (
        <UserDrawer
          key={open.id}
          user={open}
          catalog={catalog}
          packages={packages}
          onClose={() => setOpenId(null)}
          onChanged={replaceUser}
          onRemoved={() => {
            setOpenId(null);
            void reload();
          }}
        />
      )}
    </Page>
  );
}
