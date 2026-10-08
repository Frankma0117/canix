import { useMemo, useState } from 'react';
import { Plus, Search, Users, KeyRound, Sparkles, AlertTriangle, Grid3x3, ChevronRight, Phone, Check } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { AdminUser, PermissionPackage } from '../../lib/types.ts';
import { useAdminData, identityOf, portalStatus } from '../../lib/admin.ts';
import { goTo } from '../../lib/sections.tsx';
import { Page, Notice, Tabs, StatCard, Avatar } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label, Hint } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { UserDrawer } from './UserDrawer.tsx';

type Filter = 'all' | 'portal' | 'paid' | 'none' | 'review';

export function UsersPage() {
  const { users, catalog, packages, error, reload, replaceUser } = useAdminData();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const paidKeys = useMemo(() => catalog.filter((p) => p.billable).map((p) => p.key), [catalog]);
  const needsReview = (u: AdminUser) => !u.phone || !!u.locked_until || (u.role !== 'admin' && !u.packages.length && !u.allow.length);
  const matches: Record<Filter, (u: AdminUser) => boolean> = {
    all: () => true,
    portal: (u) => u.role === 'admin' || u.effective.includes('portal.access'),
    paid: (u) => u.role !== 'admin' && paidKeys.some((k) => u.effective.includes(k)),
    none: (u) => u.role !== 'admin' && u.effective.length === 0,
    review: needsReview,
  };
  const list = users ?? [];
  const count = (f: Filter) => list.filter(matches[f]).length;
  const filtered = list.filter((u) => {
    if (!matches[filter](u)) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const digits = s.replace(/\D/g, '');
    return (u.name ?? '').toLowerCase().includes(s) || (!!digits && ((u.phone ?? '').includes(digits) || u.whatsapp_id.includes(digits)));
  });
  const open = list.find((u) => u.id === openId) ?? null;

  return (
    <Page
      eyebrow="Administración"
      title="Personas"
      sticker="confianza"
      wide
      description="Quién tiene acceso al asistente y a qué. Toca a una persona para ver su ficha: datos, permisos, portal y consumo."
      actions={
        <>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Dar acceso a alguien
          </Button>
          <Button variant="secondary" onClick={() => goTo('admin-matrix')}>
            <Grid3x3 size={16} /> Ver matriz de acceso
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Users size={18} />} label="Personas con acceso" value={users ? list.length : '…'} onClick={() => setFilter('all')} />
        <StatCard icon={<KeyRound size={18} />} tone="cyan" label="Con portal web" value={users ? count('portal') : '…'} onClick={() => setFilter('portal')} />
        <StatCard icon={<Sparkles size={18} />} tone="amber" label="Con extras de pago" value={users ? count('paid') : '…'} hint="Llamadas o voz natural" onClick={() => setFilter('paid')} />
        <StatCard icon={<AlertTriangle size={18} />} tone="violet" label="Para revisar" value={users ? count('review') : '…'} hint="Sin número, sin permisos o bloqueados" onClick={() => setFilter('review')} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-60 flex-1">
          <Input icon={<Search size={16} />} placeholder="Buscar por nombre o número…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Tabs
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'Todas', count: count('all') },
          { id: 'portal', label: 'Con portal', count: count('portal') },
          { id: 'paid', label: 'Extras de pago', count: count('paid') },
          { id: 'none', label: 'Sin permisos', count: count('none') },
          { id: 'review', label: 'Revisar', count: count('review') },
        ]}
      />

      {!users && (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      )}
      {users && filtered.length === 0 && <EmptyState sticker="revisando" title="Nadie por aquí" description="No hay personas que coincidan con ese filtro o búsqueda." />}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((u, i) => {
          const id = identityOf(u);
          const status = portalStatus(u);
          const paid = catalog.filter((p) => p.billable && u.effective.includes(p.key));
          const total = u.role === 'admin' ? catalog.length : u.effective.length;
          return (
            <Card key={u.id} interactive className="group p-4 animate-fade-in" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} onClick={() => setOpenId(u.id)}>
              <div className="flex items-start gap-3">
                <Avatar name={u.name} seed={u.id} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-display text-lg font-extrabold text-ink dark:text-white">{u.name ?? '(sin nombre)'}</p>
                    {u.role === 'admin' && <Badge tone="brand">Admin</Badge>}
                  </div>
                  <p className={`flex items-center gap-1.5 text-sm ${id.known ? 'text-gray-dark' : 'font-semibold text-amber-600 dark:text-amber-300'}`}>
                    <Phone size={13} /> {id.text}
                    {!id.known && <AlertTriangle size={13} />}
                  </p>
                </div>
                <ChevronRight size={18} className="mt-1 text-gray-dark transition-transform group-hover:translate-x-0.5" />
              </div>

              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-semibold text-ink/80 dark:text-white/80">{total} de {catalog.length} funciones</span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-medium/70 dark:bg-white/10">
                  <div className="brand-gradient h-full rounded-full transition-all" style={{ width: `${catalog.length ? (total / catalog.length) * 100 : 0}%` }} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {u.packages.map((p) => (
                  <Badge key={p.id} tone="brand">
                    📦 {p.name}
                  </Badge>
                ))}
                {u.role !== 'admin' &&
                  paid.map((p) => (
                    <Badge key={p.key} tone="premium">
                      <Sparkles size={11} /> {p.label}
                    </Badge>
                  ))}
                {u.role !== 'admin' && u.deny.length > 0 && <Badge tone="error">{u.deny.length} denegado(s)</Badge>}
                {u.role !== 'admin' && !u.packages.length && !u.allow.length && <Badge tone="warning">Sin permisos</Badge>}
                {u.is_professional && <Badge tone="cyan">📅 Profesional</Badge>}
              </div>
            </Card>
          );
        })}
      </div>

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
      {creating && (
        <CreateUser
          packages={packages}
          onClose={() => setCreating(false)}
          onCreated={async (u) => {
            setCreating(false);
            await reload();
            setOpenId(u.id);
          }}
        />
      )}
    </Page>
  );
}

function CreateUser({ packages, onClose, onCreated }: { packages: PermissionPackage[]; onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const api = useApi();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pkgIds, setPkgIds] = useState<number[]>([]);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await api.post<{ user: AdminUser; notified: boolean }>('/api/admin/users', { phone, name, packageIds: pkgIds, notify });
      toast.success(r.notified ? `${name} ya tiene acceso y le escribí por WhatsApp.` : `${name} ya tiene acceso.`);
      onCreated(r.user);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Dar acceso a una persona" description="Después podrás ajustar permisos sueltos y extras de pago en su ficha." onClose={onClose} size="md">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Gómez" />
        </div>
        <div>
          <Label>Número de WhatsApp</Label>
          <Input icon={<Phone size={15} />} inputMode="tel" placeholder="573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Hint>Con indicativo de país.</Hint>
        </div>
      </div>
      <p className="mb-2 mt-5 text-sm font-bold text-ink dark:text-white">Paquete inicial</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {packages.map((p) => {
          const on = pkgIds.includes(p.id);
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => setPkgIds(on ? pkgIds.filter((x) => x !== p.id) : [...pkgIds, p.id])}
              className={`rounded-2xl border p-3 text-left transition-all ${on ? 'border-primary/60 bg-primary/5 dark:bg-primary/15' : 'border-gray-medium/70 hover:border-primary/30 dark:border-white/10'}`}
            >
              <span className="flex items-center justify-between text-sm font-bold text-ink dark:text-white">
                {p.name}
                {on && <Check size={15} className="text-primary" />}
              </span>
              <span className="mt-0.5 block text-xs text-gray-dark">{p.description}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-white/85">
        <input type="checkbox" className="h-4 w-4 accent-[#4b5cf6]" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Saludarla por WhatsApp para avisarle
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} loading={saving} disabled={!phone.trim() || !name.trim()}>
          <Plus size={16} /> Crear acceso
        </Button>
      </div>
    </Modal>
  );
}
