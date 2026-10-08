import { useEffect, useMemo, useState } from 'react';
import { Plus, KeyRound, ShieldCheck, Unlock, LogOut, Trash2, Search, Copy } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { AdminUser, PermissionDef, PermissionPackage } from '../../lib/types.ts';
import { Page, Notice } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { PermissionOverrides, type Override } from './PermissionPicker.tsx';

export function UsersPage() {
  const api = useApi();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [packages, setPackages] = useState<PermissionPackage[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [tempPwd, setTempPwd] = useState<{ user: AdminUser; password?: string; sent?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    try {
      const [u, c, p] = await Promise.all([
        api.get<AdminUser[]>('/api/admin/users'),
        api.get<PermissionDef[]>('/api/admin/permissions'),
        api.get<PermissionPackage[]>('/api/admin/packages'),
      ]);
      setUsers(u);
      setCatalog(c);
      setPackages(p);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users ?? []).filter((u) => !s || (u.name ?? '').toLowerCase().includes(s) || u.phone.includes(s.replace(/\D/g, '') || '§'));
  }, [users, q]);

  const labelOf = (key: string) => catalog.find((c) => c.key === key)?.label ?? key;

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try {
      await fn();
      setFlash(ok);
      setTimeout(() => setFlash(null), 3500);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title="Usuarios y permisos"
      wide
      description="Cada funcionalidad es un permiso. Asígnale a cada persona paquetes y, si hace falta, permite o deniega permisos sueltos (lo denegado siempre gana). También se puede hacer por chat con el bot."
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> Dar acceso
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {flash && <Notice tone="success">{flash}</Notice>}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-3 text-gray-dark" />
        <Input placeholder="Buscar por nombre o número…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: '2.2rem' }} />
      </div>

      {!users && <Skeleton className="h-24" />}
      <div className="space-y-2">
        {filtered.map((u) => (
          <Card key={u.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink dark:text-white">
                  {u.name ?? '(sin nombre)'} <span className="text-sm font-normal text-gray-dark">+{u.phone}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {u.role === 'admin' && <Badge tone="info">Administrador</Badge>}
                  {u.packages.map((p) => (
                    <Badge key={p.id} tone="neutral">
                      📦 {p.name}
                    </Badge>
                  ))}
                  {u.allow.map((k) => (
                    <Badge key={k} tone="success">
                      + {labelOf(k)}
                    </Badge>
                  ))}
                  {u.deny.map((k) => (
                    <Badge key={k} tone="error">
                      − {labelOf(k)}
                    </Badge>
                  ))}
                  {u.role !== 'admin' && !u.packages.length && !u.allow.length && <Badge tone="warning">Sin permisos</Badge>}
                </div>
                <p className="mt-1.5 text-xs text-gray-dark">
                  Portal: {u.effective.includes('portal.access') ? (u.has_password ? (u.must_change_password ? 'contraseña temporal pendiente de cambio' : 'activo') : 'permitido, sin contraseña') : 'sin acceso'}
                  {u.locked_until && ' · 🔒 bloqueado por intentos fallidos'}
                  {u.is_professional && ' · 📅 profesional de agenda'}
                </p>
              </div>
              {u.role !== 'admin' ? (
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="secondary" onClick={() => setEditing(u)}>
                    <ShieldCheck size={15} /> Permisos
                  </Button>
                  <Button variant="secondary" onClick={() => setTempPwd({ user: u })} title="Contraseña temporal del portal">
                    <KeyRound size={15} />
                  </Button>
                  {u.locked_until && (
                    <Button variant="secondary" onClick={() => act(() => api.post(`/api/admin/users/${u.id}/unlock`), 'Cuenta desbloqueada.')} title="Desbloquear">
                      <Unlock size={15} />
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => act(() => api.post(`/api/admin/users/${u.id}/logout-all`), 'Sesiones cerradas.')}
                    title="Cerrar todas sus sesiones del portal"
                  >
                    <LogOut size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    title="Quitar acceso y borrar sus datos"
                    onClick={() => {
                      const typed = prompt(`Esto borra a ${u.name} y TODA su información (no se puede deshacer).\nEscribe su número (${u.phone}) para confirmar:`);
                      if (typed?.replace(/\D/g, '') === u.phone) act(() => api.del(`/api/admin/users/${u.id}?confirm=${u.id}`), 'Usuario eliminado.');
                    }}
                  >
                    <Trash2 size={15} className="text-error" />
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setTempPwd({ user: u })}>
                  <KeyRound size={15} /> Contraseña temporal
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {editing && <AccessEditor user={editing} catalog={catalog} packages={packages} onClose={() => setEditing(null)} onSaved={() => act(async () => setEditing(null), 'Permisos actualizados.')} />}
      {creating && <CreateUser packages={packages} onClose={() => setCreating(false)} onCreated={() => act(async () => setCreating(false), 'Acceso creado.')} />}
      {tempPwd && (
        <Modal title={`Contraseña temporal · ${tempPwd.user.name ?? ''}`} onClose={() => setTempPwd(null)}>
          {!tempPwd.password ? (
            <>
              <p className="mb-4 text-sm text-gray-dark">
                Se genera una contraseña nueva (la anterior deja de servir y se cierran sus sesiones). Al entrar, el portal le pedirá cambiarla.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const r = await api.post<{ password: string; sent: boolean }>(`/api/admin/users/${tempPwd.user.id}/temp-password`, { sendWhatsApp: false });
                      setTempPwd({ ...tempPwd, ...r });
                    } catch (e) {
                      setError(errMsg(e));
                    }
                  }}
                >
                  Solo mostrármela
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const r = await api.post<{ password: string; sent: boolean }>(`/api/admin/users/${tempPwd.user.id}/temp-password`, { sendWhatsApp: true });
                      setTempPwd({ ...tempPwd, ...r });
                    } catch (e) {
                      setError(errMsg(e));
                    }
                  }}
                >
                  Generar y enviar por WhatsApp
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-dark">Contraseña temporal (se muestra solo esta vez):</p>
              <div className="my-3 flex items-center gap-2 rounded-xl bg-gray-light p-3 font-mono text-lg dark:bg-white/5">
                {tempPwd.password}
                <button className="ml-auto text-gray-dark hover:text-primary" onClick={() => navigator.clipboard?.writeText(tempPwd.password!)} aria-label="Copiar">
                  <Copy size={16} />
                </button>
              </div>
              <p className="text-sm">{tempPwd.sent ? '✅ También se la envié por WhatsApp.' : 'Pásasela tú por un medio seguro.'}</p>
              {!tempPwd.user.effective.includes('portal.access') && <p className="mt-2 text-sm text-warning">Ojo: no tiene el permiso "Acceso al portal web", así que no podrá entrar hasta que se lo des.</p>}
            </>
          )}
        </Modal>
      )}
    </Page>
  );
}

function AccessEditor({
  user,
  catalog,
  packages,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  catalog: PermissionDef[];
  packages: PermissionPackage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [pkgIds, setPkgIds] = useState<number[]>(user.packages.map((p) => p.id));
  const [overrides, setOverrides] = useState<Record<string, Override>>(() => {
    const o: Record<string, Override> = {};
    user.allow.forEach((k) => (o[k] = 'allow'));
    user.deny.forEach((k) => (o[k] = 'deny'));
    return o;
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fromPackages = useMemo(() => new Set(packages.filter((p) => pkgIds.includes(p.id)).flatMap((p) => p.permissions)), [packages, pkgIds]);
  const effective = catalog.filter((p) => overrides[p.key] === 'allow' || ((overrides[p.key] ?? 'inherit') === 'inherit' && fromPackages.has(p.key)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/admin/users/${user.id}/access`, {
        packageIds: pkgIds,
        allow: Object.entries(overrides).filter(([, v]) => v === 'allow').map(([k]) => k),
        deny: Object.entries(overrides).filter(([, v]) => v === 'deny').map(([k]) => k),
      });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Permisos de ${user.name ?? user.phone}`} onClose={onClose} size="lg">
      {error && <Notice tone="error">{error}</Notice>}
      <p className="mb-2 text-sm font-medium text-ink dark:text-white">Paquetes</p>
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        {packages.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-medium/70 p-3 hover:border-primary/50 dark:border-white/10">
            <input type="checkbox" className="mt-1" checked={pkgIds.includes(p.id)} onChange={() => setPkgIds(pkgIds.includes(p.id) ? pkgIds.filter((x) => x !== p.id) : [...pkgIds, p.id])} />
            <span>
              <span className="text-sm font-medium text-ink dark:text-white">{p.name}</span>
              <span className="block text-xs text-gray-dark">{p.description}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mb-2 text-sm font-medium text-ink dark:text-white">Ajustes por permiso</p>
      <PermissionOverrides catalog={catalog} fromPackages={fromPackages} value={overrides} onChange={setOverrides} />
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-5 border-t border-gray-medium/70 bg-white px-6 py-4 dark:border-white/10 dark:bg-[#1c1d3a]">
        <p className="mb-3 text-xs text-gray-dark">
          Resultado: <strong>{effective.length ? effective.map((p) => p.label).join(', ') : 'ningún permiso'}</strong>
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar permisos'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateUser({ packages, onClose, onCreated }: { packages: PermissionPackage[]; onClose: () => void; onCreated: () => void }) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pkgIds, setPkgIds] = useState<number[]>([]);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api.post('/api/admin/users', { phone, name, packageIds: pkgIds, notify });
      onCreated();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Modal title="Dar acceso a una persona" onClose={onClose} size="md">
      {error && <Notice tone="error">{error}</Notice>}
      <Label>Número de WhatsApp (con indicativo)</Label>
      <Input inputMode="tel" placeholder="573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div className="h-3" />
      <Label>Nombre</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <p className="mb-2 mt-4 text-sm font-medium text-ink dark:text-white">Paquetes</p>
      <div className="space-y-1">
        {packages.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-gray-light dark:hover:bg-white/5">
            <input type="checkbox" className="mt-1" checked={pkgIds.includes(p.id)} onChange={() => setPkgIds(pkgIds.includes(p.id) ? pkgIds.filter((x) => x !== p.id) : [...pkgIds, p.id])} />
            <span>
              <span className="text-sm font-medium text-ink dark:text-white">{p.name}</span>
              <span className="block text-xs text-gray-dark">{p.description}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Saludarlo por WhatsApp para avisarle
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={!phone.trim() || !name.trim()}>
          Crear acceso
        </Button>
      </div>
    </Modal>
  );
}
