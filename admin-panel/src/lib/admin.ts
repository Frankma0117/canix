import { useCallback, useEffect, useState } from 'react';
import { useApi, errMsg } from './api.ts';
import type { AdminUser, PermissionDef, PermissionPackage } from './types.ts';

/** Users + permission catalog + packages - everything the access screens need, loaded together. */
export function useAdminData() {
  const api = useApi();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [packages, setPackages] = useState<PermissionPackage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [u, c, p] = await Promise.all([
        api.get<AdminUser[]>('/api/admin/users'),
        api.get<PermissionDef[]>('/api/admin/permissions'),
        api.get<PermissionPackage[]>('/api/admin/packages'),
      ]);
      setUsers(u);
      setCatalog(c);
      setPackages(p);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Swaps one user in place (after a single-user API call returned its fresh view). */
  const replaceUser = useCallback((u: AdminUser) => setUsers((all) => (all ? all.map((x) => (x.id === u.id ? u : x)) : all)), []);

  return { users, catalog, packages, error, reload, replaceUser };
}

export type PermissionSource = 'admin' | 'allow' | 'deny' | 'package' | 'none';

/** Why a person has (or doesn't have) a permission - drives the matrix cells and the profile view. */
export function permissionSource(user: AdminUser, key: string, packages: PermissionPackage[]): PermissionSource {
  if (user.role === 'admin') return 'admin';
  if (user.deny.includes(key)) return 'deny';
  if (user.allow.includes(key)) return 'allow';
  const ids = new Set(user.packages.map((p) => p.id));
  if (packages.some((p) => ids.has(p.id) && p.permissions.includes(key))) return 'package';
  return 'none';
}

export function hasPermission(src: PermissionSource): boolean {
  return src === 'admin' || src === 'allow' || src === 'package';
}

/** "+57 300 123 4567" for a real number; the access code otherwise. */
export function identityOf(u: Pick<AdminUser, 'phone' | 'whatsapp_id'>): { text: string; known: boolean } {
  if (!u.phone) return { text: `Código ${u.whatsapp_id}`, known: false };
  const d = u.phone;
  const pretty = d.startsWith('57') && d.length === 12 ? `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : `+${d}`;
  return { text: pretty, known: true };
}

export function portalStatus(u: AdminUser): { label: string; tone: 'success' | 'warning' | 'neutral' | 'error' } {
  if (u.locked_until) return { label: 'Bloqueado', tone: 'error' };
  if (u.role !== 'admin' && !u.effective.includes('portal.access')) return { label: 'Sin portal', tone: 'neutral' };
  if (!u.has_password) return { label: 'Sin contraseña', tone: 'warning' };
  if (u.must_change_password) return { label: 'Clave temporal', tone: 'warning' };
  return { label: 'Portal activo', tone: 'success' };
}

/** "Demo · quedan 5 h" / "Demo vencida" - null when it isn't a demo account. */
export function demoLabel(u: Pick<AdminUser, 'demo_status' | 'demo_expires_at'>): { label: string; tone: 'violet' | 'neutral' } | null {
  if (!u.demo_status) return null;
  if (u.demo_status === 'expired' || !u.demo_expires_at) return { label: 'Demo vencida', tone: 'neutral' };
  const ms = new Date(u.demo_expires_at).getTime() - Date.now();
  if (ms <= 0) return { label: 'Demo vencida', tone: 'neutral' };
  const h = Math.floor(ms / 3_600_000);
  return { label: h >= 1 ? `Demo · quedan ${h} h` : `Demo · quedan ${Math.max(1, Math.round(ms / 60_000))} min`, tone: 'violet' };
}

/** Module -> permissions, in catalog order. */
export function groupByModule(perms: PermissionDef[]): [string, PermissionDef[]][] {
  const map = new Map<string, PermissionDef[]>();
  for (const p of perms) map.set(p.module, [...(map.get(p.module) ?? []), p]);
  return [...map];
}
