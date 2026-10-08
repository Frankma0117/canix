import { useEffect, useState } from 'react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { AuditEntry } from '../../lib/types.ts';
import { Page, Notice } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';

const ACTIONS: Record<string, string> = {
  'access.set': 'Cambió permisos',
  'package.assign': 'Asignó paquete',
  'package.unassign': 'Quitó paquete',
  'package.create': 'Creó paquete',
  'package.update': 'Editó paquete',
  'package.delete': 'Borró paquete',
  'permission.allow': 'Permitió permiso',
  'permission.deny': 'Denegó permiso',
  'permission.clear': 'Quitó ajuste de permiso',
  'auth.temp_password': 'Contraseña temporal',
  'auth.password_changed': 'Cambió su contraseña',
  'auth.locked': 'Cuenta bloqueada (intentos fallidos)',
  'auth.unlocked': 'Desbloqueó cuenta',
  'auth.sessions_revoked': 'Cerró sesiones',
  'user.removed': 'Eliminó usuario',
  'scheduling.share': 'Compartió acceso a agenda',
  'scheduling.unshare': 'Quitó acceso a agenda',
  'scheduling.group_create': 'Creó agenda general',
  'scheduling.group_update': 'Editó agenda general',
  'scheduling.group_delete': 'Borró agenda general',
};

export function AuditPage() {
  const api = useApi();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<AuditEntry[]>('/api/admin/audit?limit=500').then(setRows).catch((e) => setError(errMsg(e)));
  }, [api]);

  return (
    <Page title="Auditoría" wide description="Registro de cada cambio de acceso: quién lo hizo, a quién y cuándo (hora UTC del servidor).">
      {error && <Notice tone="error">{error}</Notice>}
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-gray-dark">
            <tr>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Quién</th>
              <th className="px-4 py-3">Acción</th>
              <th className="px-4 py-3">Sobre</th>
              <th className="px-4 py-3">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-medium/60 dark:divide-white/10">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2 text-gray-dark">{r.created_at}</td>
                <td className="px-4 py-2">{r.actor_name ?? 'Sistema'}</td>
                <td className="px-4 py-2">{ACTIONS[r.action] ?? r.action}</td>
                <td className="px-4 py-2">{r.target_name ?? '—'}</td>
                <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-gray-dark" title={r.detail ?? ''}>
                  {r.detail ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
