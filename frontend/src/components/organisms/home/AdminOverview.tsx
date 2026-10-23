import { useEffect, useState } from 'react';
import { Users, KeyRound, Sparkles, AlertTriangle, DollarSign, BarChart3, Smartphone, ScrollText } from 'lucide-react';
import { useApi } from '../../../services/api.ts';
import { goTo } from '../../../utils/navigation.ts';
import type { AdminUser, AuditEntry, UsageRow } from '../../../types/index.ts';
import { estimateCost, useRates, usd } from '../../../services/usage.ts';
import { Sticker } from '../../atoms/Sticker.tsx';
import { Card } from '../../atoms/Card.tsx';
import { StatCard } from '../../molecules/StatCard.tsx';
import { Button } from '../../atoms/Button.tsx';

export const ACTION_LABELS: Record<string, string> = {
  'access.set': 'cambió los permisos de',
  'permission.allow': 'permitió una función a',
  'permission.deny': 'denegó una función a',
  'permission.clear': 'devolvió a “según paquete” un permiso de',
  'package.assign': 'asignó un paquete a',
  'package.unassign': 'quitó un paquete a',
  'package.create': 'creó un paquete',
  'package.update': 'editó un paquete',
  'package.delete': 'borró un paquete',
  'user.removed': 'quitó el acceso a una persona',
  'user.phone_set': 'registró el número de',
  'auth.locked': 'bloqueo por intentos fallidos de',
  'auth.unlocked': 'desbloqueó a',
  'auth.sessions_revoked': 'cerró las sesiones de',
};

export function AdminOverview() {
  const api = useApi();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [rates] = useRates();

  useEffect(() => {
    api.get<AdminUser[]>('/api/admin/users').then(setUsers).catch(() => setUsers([]));
    api.get<{ rows: UsageRow[] }>('/api/admin/usage?days=30').then((r) => setUsage(r.rows)).catch(() => setUsage([]));
    api.get<AuditEntry[]>('/api/admin/audit?limit=6').then(setAudit).catch(() => setAudit([]));
  }, [api]);

  const list = users ?? [];
  const portal = list.filter((u) => u.role === 'admin' || u.effective.includes('portal.access')).length;
  const paid = list.filter((u) => u.role !== 'admin' && (u.effective.includes('reminders.calls') || u.effective.includes('voice.premium'))).length;
  const review = list.filter((u) => !u.phone || u.locked_until || (u.role !== 'admin' && !u.packages.length && !u.allow.length));
  const cost = (usage ?? []).reduce((s, r) => s + estimateCost(r, rates), 0);

  return (
    <>
      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Users size={18} />} label="Personas con acceso" value={users ? list.length : '…'} onClick={() => goTo('admin-users')} />
        <StatCard icon={<KeyRound size={18} />} tone="cyan" label="Usan el portal" value={users ? portal : '…'} onClick={() => goTo('admin-users')} />
        <StatCard icon={<Sparkles size={18} />} tone="amber" label="Con extras de pago" value={users ? paid : '…'} hint="Llamadas o voz natural" onClick={() => goTo('admin-matrix')} />
        <StatCard icon={<DollarSign size={18} />} tone="violet" label="Costo estimado (30 días)" value={usage ? usd(cost) : '…'} onClick={() => goTo('admin-usage')} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <p className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
            <AlertTriangle size={18} className="text-amber-500" /> Para revisar
          </p>
          {users && review.length === 0 && (
            <div className="flex items-center gap-3">
              <Sticker name="control" size={72} />
              <p className="text-sm text-gray-dark">Todo en orden: todos tienen número, permisos y ninguna cuenta está bloqueada.</p>
            </div>
          )}
          <div className="space-y-2">
            {review.slice(0, 5).map((u) => (
              <button key={u.id} onClick={() => goTo('admin-users')} className="flex w-full items-center justify-between gap-3 rounded-xl bg-gray-light px-3 py-2.5 text-left text-sm hover:bg-secondary dark:bg-white/5 dark:hover:bg-white/10">
                <span className="font-semibold text-ink dark:text-white">{u.name ?? '(sin nombre)'}</span>
                <span className="text-xs text-gray-dark">
                  {!u.phone ? 'Falta su número real' : u.locked_until ? 'Cuenta bloqueada' : 'Sin permisos asignados'}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
            <ScrollText size={18} className="text-primary" /> Actividad reciente
          </p>
          {audit && audit.length === 0 && <p className="text-sm text-gray-dark">Sin cambios recientes.</p>}
          <ol className="space-y-3">
            {(audit ?? []).map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="brand-gradient mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                <span className="min-w-0">
                  <span className="text-ink dark:text-white">
                    <strong>{a.actor_name ?? 'Sistema'}</strong> {ACTION_LABELS[a.action] ?? a.action} {a.target_name && <strong>{a.target_name}</strong>}
                  </span>
                  <span className="block text-xs text-gray-dark">{a.created_at.replace('T', ' ').slice(0, 16)}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => goTo('admin-usage')}>
              <BarChart3 size={14} /> Uso y costos
            </Button>
            <Button size="sm" variant="soft" onClick={() => goTo('connection')}>
              <Smartphone size={14} /> Conexión WhatsApp
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
