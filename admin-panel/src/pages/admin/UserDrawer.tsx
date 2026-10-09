import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  Copy,
  KeyRound,
  LogOut,
  Mic,
  Phone,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserRound,
  Sparkles,
  Send,
} from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { AdminUser, PermissionDef, PermissionPackage, UsageRow } from '../../lib/types.ts';
import { identityOf, portalStatus, permissionSource, hasPermission, groupByModule, demoLabel } from '../../lib/admin.ts';
import { operationInfo, estimateCost, useRates, usd, compact } from '../../lib/usage.ts';
import { Drawer } from '../../components/ui/Modal.tsx';
import { Avatar, Notice, Tabs } from '../../components/ui/Page.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label, Hint } from '../../components/ui/Input.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { AccessEditor, PaidBadge, type Override } from './PermissionPicker.tsx';

type TabId = 'summary' | 'access' | 'security' | 'usage';

export function UserDrawer({
  user,
  catalog,
  packages,
  initialTab = 'summary',
  onClose,
  onChanged,
  onRemoved,
}: {
  user: AdminUser;
  catalog: PermissionDef[];
  packages: PermissionPackage[];
  initialTab?: TabId;
  onClose: () => void;
  onChanged: (u: AdminUser) => void;
  onRemoved: () => void;
}) {
  const [tab, setTab] = useState<TabId>(user.role === 'admin' && initialTab === 'access' ? 'summary' : initialTab);
  const id = identityOf(user);
  const status = portalStatus(user);
  const isAdmin = user.role === 'admin';
  const paidOn = catalog.filter((p) => p.billable && user.effective.includes(p.key));

  return (
    <Drawer
      title={user.name ?? '(sin nombre)'}
      onClose={onClose}
      header={
        <div className="mb-3 flex items-center gap-3">
          <Avatar name={user.name} seed={user.id} size={52} />
          <div className="flex flex-wrap gap-1.5">
            {isAdmin && <Badge tone="brand">Administrador</Badge>}
            {demoLabel(user) && <Badge tone={demoLabel(user)!.tone}>🧪 {demoLabel(user)!.label}</Badge>}
            <Badge tone={status.tone}>{status.label}</Badge>
            {paidOn.map((p) => (
              <Badge key={p.key} tone="premium">
                <Sparkles size={11} /> {p.label}
              </Badge>
            ))}
          </div>
        </div>
      }
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Phone size={14} /> {id.text}
          {!id.known && <Badge tone="warning">Falta el número real</Badge>}
        </span>
      }
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'summary', label: 'Resumen' },
          ...(isAdmin ? [] : [{ id: 'access' as const, label: 'Permisos' }]),
          { id: 'security', label: 'Portal y seguridad' },
          { id: 'usage', label: 'Uso' },
        ]}
      />
      {tab === 'summary' && <SummaryTab user={user} catalog={catalog} packages={packages} onChanged={onChanged} onEditAccess={() => setTab('access')} />}
      {tab === 'access' && !isAdmin && <AccessTab user={user} catalog={catalog} packages={packages} onChanged={onChanged} />}
      {tab === 'security' && <SecurityTab user={user} onChanged={onChanged} onRemoved={onRemoved} />}
      {tab === 'usage' && <UsageTab user={user} />}
    </Drawer>
  );
}

function SummaryTab({
  user,
  catalog,
  packages,
  onChanged,
  onEditAccess,
}: {
  user: AdminUser;
  catalog: PermissionDef[];
  packages: PermissionPackage[];
  onChanged: (u: AdminUser) => void;
  onEditAccess: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const id = identityOf(user);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (name.trim() && name.trim() !== user.name) body.name = name.trim();
      if (phone.replace(/\D/g, '') && phone.replace(/\D/g, '') !== user.phone) body.phone = phone;
      if (!Object.keys(body).length) return toast.success('No hay cambios que guardar.');
      onChanged(await api.put<AdminUser>(`/api/admin/users/${user.id}`, body));
      toast.success('Datos actualizados.');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function lookUp() {
    setLooking(true);
    try {
      const r = await api.post<{ found: boolean; user: AdminUser }>(`/api/admin/users/${user.id}/resolve-phone`);
      onChanged(r.user);
      if (r.found) {
        setPhone(r.user.phone ?? '');
        toast.success(`¡Listo! WhatsApp confirmó el número +${r.user.phone}.`);
      } else toast.error('WhatsApp todavía no comparte ese número. Escríbelo a mano o espera a que esa persona le escriba al bot.');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLooking(false);
    }
  }

  const modules = groupByModule(catalog);

  return (
    <div className="space-y-5">
      {!id.known && (
        <Notice tone="warning">
          <p className="font-semibold">WhatsApp no nos ha compartido el número real de esta persona.</p>
          <p className="mt-1">
            Por ahora la identificamos con el código <strong>{user.whatsapp_id}</strong> (también le sirve para entrar al portal). Se corrige solo cuando vuelva a escribirle al bot, o puedes
            buscarlo o escribirlo aquí.
          </p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={lookUp} loading={looking}>
            <Search size={14} /> Buscar número en WhatsApp
          </Button>
        </Notice>
      )}

      {user.demo_status && <DemoCard user={user} onChanged={onChanged} />}

      <Card className="p-5">
        <p className="mb-4 flex items-center gap-2 font-display text-base font-extrabold text-ink dark:text-white">
          <UserRound size={18} className="text-primary" /> Datos
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Número real de WhatsApp</Label>
            <Input icon={<Phone size={15} />} inputMode="tel" placeholder="573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Hint>Con indicativo de país, solo números.</Hint>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-gray-dark">
            <Mic size={13} /> Voz: {user.voice_gender === 'female' ? 'femenina' : user.voice_gender === 'male' ? 'masculina' : 'sin elegir'} · Género:{' '}
            {user.gender === 'female' ? 'mujer' : user.gender === 'male' ? 'hombre' : 'sin definir'} · Desde {user.created_at.slice(0, 10)}
          </p>
          <Button size="sm" onClick={save} loading={saving}>
            <Check size={14} /> Guardar datos
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-display text-base font-extrabold text-ink dark:text-white">
            <ShieldCheck size={18} className="text-primary" /> A qué tiene acceso
          </p>
          {user.role !== 'admin' && (
            <Button size="sm" variant="soft" onClick={onEditAccess}>
              Editar permisos
            </Button>
          )}
        </div>
        {user.role === 'admin' ? (
          <p className="text-sm text-gray-dark">El administrador tiene acceso total a todo, incluidos los extras de pago.</p>
        ) : (
          <div className="space-y-3">
            {user.packages.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {user.packages.map((p) => (
                  <Badge key={p.id} tone="brand">
                    📦 {p.name}
                  </Badge>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {modules.map(([module, perms]) => (
                <div key={module} className="rounded-xl bg-gray-light p-3 dark:bg-white/5">
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-dark">{module}</p>
                  {perms.map((p) => {
                    const src = permissionSource(user, p.key, packages);
                    const on = hasPermission(src);
                    return (
                      <p key={p.key} className={`flex items-center gap-1.5 text-sm ${on ? 'font-semibold text-ink dark:text-white' : 'text-gray-dark/70 line-through decoration-gray-dark/30'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-success' : src === 'deny' ? 'bg-error' : 'bg-gray-medium'}`} />
                        {p.label}
                        {p.billable && on && <Sparkles size={12} className="text-amber-500" />}
                      </p>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function DemoCard({ user, onChanged }: { user: AdminUser; onChanged: (u: AdminUser) => void }) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const d = demoLabel(user)!;
  async function act(action: 'extend' | 'convert', hours?: number) {
    setBusy(action + (hours ?? ''));
    try {
      onChanged(await api.post<AdminUser>(`/api/admin/users/${user.id}/demo`, { action, hours }));
      toast.success(action === 'convert' ? `${user.name ?? 'La persona'} ya es cliente: ajusta sus permisos si hace falta.` : 'Demo extendida.');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
      <p className="font-display text-base font-extrabold text-ink dark:text-white">🧪 Cuenta demo · {d.label.replace('Demo · ', '')}</p>
      <p className="mt-1 text-sm text-gray-dark">
        {user.demo_expires_at ? `Vence el ${new Date(user.demo_expires_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}. ` : ''}
        Creada desde la página pública. Al vencer se pausa (su información queda guardada).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => act('convert')} loading={busy === 'convert'}>
          Convertir en cliente
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act('extend', 24)} loading={busy === 'extend24'}>
          +1 día
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act('extend', 72)} loading={busy === 'extend72'}>
          +3 días
        </Button>
      </div>
    </div>
  );
}

function AccessTab({ user, catalog, packages, onChanged }: { user: AdminUser; catalog: PermissionDef[]; packages: PermissionPackage[]; onChanged: (u: AdminUser) => void }) {
  const api = useApi();
  const toast = useToast();
  const [pkgIds, setPkgIds] = useState<number[]>(user.packages.map((p) => p.id));
  const [overrides, setOverrides] = useState<Record<string, Override>>(() => {
    const o: Record<string, Override> = {};
    user.allow.forEach((k) => (o[k] = 'allow'));
    user.deny.forEach((k) => (o[k] = 'deny'));
    return o;
  });
  const [saving, setSaving] = useState(false);

  const fromPackages = useMemo(() => new Set(packages.filter((p) => pkgIds.includes(p.id)).flatMap((p) => p.permissions)), [packages, pkgIds]);
  const effective = catalog.filter((p) => overrides[p.key] === 'allow' || ((overrides[p.key] ?? 'inherit') === 'inherit' && fromPackages.has(p.key)));
  const before = new Set(user.effective);
  const gained = effective.filter((p) => !before.has(p.key));
  const lost = catalog.filter((p) => before.has(p.key) && !effective.some((e) => e.key === p.key));
  const dirty = gained.length > 0 || lost.length > 0 || pkgIds.slice().sort().join() !== user.packages.map((p) => p.id).sort().join();

  async function save() {
    setSaving(true);
    try {
      const updated = await api.put<AdminUser>(`/api/admin/users/${user.id}/access`, {
        packageIds: pkgIds,
        allow: Object.entries(overrides).filter(([, v]) => v === 'allow').map(([k]) => k),
        deny: Object.entries(overrides).filter(([, v]) => v === 'deny').map(([k]) => k),
      });
      onChanged(updated);
      toast.success(`Permisos de ${user.name ?? 'esta persona'} guardados.`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <AccessEditor catalog={catalog} packages={packages} pkgIds={pkgIds} onPkgIds={setPkgIds} overrides={overrides} onOverrides={setOverrides} />
      <div className="sticky bottom-0 -mx-6 -mb-5 mt-6 border-t border-gray-medium/70 bg-white/95 px-6 py-4 backdrop-blur dark:border-white/10 dark:bg-[#151a3a]/95">
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <span className="font-semibold text-ink dark:text-white">{effective.length} funciones activas.</span>
          {gained.map((p) => (
            <Badge key={p.key} tone="success">
              + {p.label}
            </Badge>
          ))}
          {lost.map((p) => (
            <Badge key={p.key} tone="error">
              − {p.label}
            </Badge>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={save} loading={saving} disabled={!dirty}>
            <Check size={16} /> Guardar permisos
          </Button>
        </div>
      </div>
    </div>
  );
}

function SecurityTab({ user, onChanged, onRemoved }: { user: AdminUser; onChanged: (u: AdminUser) => void; onRemoved: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [pwd, setPwd] = useState<{ password: string; sent: boolean; loginId: string; phoneKnown: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const status = portalStatus(user);
  const noPortal = user.role !== 'admin' && !user.effective.includes('portal.access');

  async function run<T>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function temp(sendWhatsApp: boolean) {
    const r = await run('pwd', () => api.post<{ password: string; sent: boolean; loginId: string; phoneKnown: boolean }>(`/api/admin/users/${user.id}/temp-password`, { sendWhatsApp }));
    if (r) {
      setPwd(r);
      onChanged(await api.get<AdminUser[]>('/api/admin/users').then((all) => all.find((u) => u.id === user.id) ?? user));
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-display text-base font-extrabold text-ink dark:text-white">
            <KeyRound size={18} className="text-primary" /> Acceso al portal web
          </p>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        {noPortal && <Notice tone="warning">No tiene el permiso “Acceso al portal web”: aunque le generes contraseña, no podrá entrar hasta que se lo des en Permisos.</Notice>}
        {!pwd ? (
          <>
            <p className="mb-4 text-sm text-gray-dark">
              Genera una contraseña temporal nueva: la anterior deja de servir, se cierran sus sesiones y el portal le pide cambiarla al entrar.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => temp(true)} loading={busy === 'pwd'}>
                <Send size={15} /> Generar y enviar por WhatsApp
              </Button>
              <Button variant="secondary" onClick={() => temp(false)} disabled={busy === 'pwd'}>
                Solo mostrármela
              </Button>
            </div>
          </>
        ) : (
          <div className="animate-pop-in">
            <p className="text-sm text-gray-dark">Datos de ingreso (la contraseña se muestra solo esta vez):</p>
            <div className="my-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-gray-light p-3 dark:bg-white/5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-dark">{pwd.phoneKnown ? 'Número' : 'Código de acceso'}</p>
                <p className="font-mono text-lg text-ink dark:text-white">{pwd.loginId}</p>
              </div>
              <div className="flex items-center rounded-xl bg-gray-light p-3 dark:bg-white/5">
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-dark">Contraseña temporal</p>
                  <p className="font-mono text-lg text-ink dark:text-white">{pwd.password}</p>
                </div>
                <button
                  className="rounded-lg p-2 text-gray-dark hover:bg-white hover:text-primary dark:hover:bg-white/10"
                  onClick={() => {
                    navigator.clipboard?.writeText(pwd.password);
                    toast.success('Contraseña copiada.');
                  }}
                  aria-label="Copiar"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>
            <p className="text-sm">{pwd.sent ? '✅ También se la envié por WhatsApp.' : 'Pásasela tú por un medio seguro.'}</p>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <p className="mb-3 flex items-center gap-2 font-display text-base font-extrabold text-ink dark:text-white">
          <ShieldCheck size={18} className="text-primary" /> Sesiones
        </p>
        <div className="flex flex-wrap gap-2">
          {user.locked_until && (
            <Button variant="secondary" loading={busy === 'unlock'} onClick={async () => { const u = await run('unlock', () => api.post<AdminUser>(`/api/admin/users/${user.id}/unlock`), 'Cuenta desbloqueada.'); if (u) onChanged(u); }}>
              <Unlock size={15} /> Desbloquear (intentos fallidos)
            </Button>
          )}
          <Button variant="secondary" loading={busy === 'logout'} onClick={() => run('logout', () => api.post(`/api/admin/users/${user.id}/logout-all`), 'Se cerraron todas sus sesiones.')}>
            <LogOut size={15} /> Cerrar todas sus sesiones
          </Button>
        </div>
      </Card>

      {user.role !== 'admin' && (
        <div className="rounded-2xl border border-error/30 bg-error/5 p-5">
          <p className="mb-1 flex items-center gap-2 font-display text-base font-extrabold text-red-700 dark:text-red-300">
            <AlertTriangle size={18} /> Zona peligrosa
          </p>
          <p className="mb-3 text-sm text-gray-dark">
            Quitarle el acceso borra a esta persona y <strong>toda</strong> su información (recordatorios, rutinas, notas…). No se puede deshacer.
          </p>
          <Label>Escribe su nombre para confirmar: “{user.name}”</Label>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-48 flex-1">
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.name ?? ''} />
            </div>
            <Button
              variant="danger"
              disabled={confirm.trim().toLowerCase() !== (user.name ?? '').trim().toLowerCase()}
              loading={busy === 'del'}
              onClick={async () => {
                const ok = await run('del', () => api.del(`/api/admin/users/${user.id}?confirm=${user.id}`), `${user.name} ya no tiene acceso.`);
                if (ok !== undefined) onRemoved();
              }}
            >
              <Trash2 size={15} /> Quitar acceso y borrar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UsageTab({ user }: { user: AdminUser }) {
  const api = useApi();
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [days, setDays] = useState(30);
  const [rates] = useRates();
  useEffect(() => {
    setRows(null);
    api
      .get<{ rows: UsageRow[] }>(`/api/admin/usage?days=${days}`)
      .then((r) => setRows(r.rows.filter((x) => x.user_id === user.id)))
      .catch(() => setRows([]));
  }, [api, days, user.id]);
  const total = (rows ?? []).reduce((s, r) => s + estimateCost(r, rates), 0);

  return (
    <div>
      <Tabs
        active={String(days) as '7' | '30' | '90'}
        onChange={(d) => setDays(Number(d))}
        tabs={[
          { id: '7', label: '7 días' },
          { id: '30', label: '30 días' },
          { id: '90', label: '90 días' },
        ]}
      />
      {rows && rows.length === 0 ? (
        <EmptyState sticker="progreso" title="Sin consumo registrado" description="Aquí verás su uso de IA, voz natural y llamadas en el periodo elegido." />
      ) : (
        <div className="space-y-2">
          {(rows ?? []).map((r) => {
            const info = operationInfo(r.operation);
            return (
              <Card key={r.operation} className="flex items-center gap-3 p-4">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${info.paid ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15' : 'bg-primary/10 text-primary'}`}>
                  <BarChart3 size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
                    {info.label} {info.paid && <PaidBadge />}
                  </p>
                  <p className="text-xs text-gray-dark">
                    {compact(r.uses)} usos · {compact(r.input_units + r.output_units)} {info.unit}
                  </p>
                </div>
                <p className="font-display text-lg font-black text-ink dark:text-white">{usd(estimateCost(r, rates))}</p>
              </Card>
            );
          })}
          {rows && rows.length > 0 && (
            <p className="pt-2 text-right text-sm text-gray-dark">
              Costo estimado del periodo: <strong className="text-ink dark:text-white">{usd(total)}</strong> (tarifas editables en “Uso y costos”)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
