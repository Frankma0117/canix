import { useState } from 'react';
import { Check, Copy, Plus, Sparkles, Trash2 } from 'lucide-react';
import { errMsg, useApi } from '../../services/api.ts';
import { rememberStore, useStores } from '../../services/store.tsx';
import type { Store } from '../../types/store.ts';
import { goTo } from '../../utils/navigation.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Modal } from '../../components/organisms/Modal.tsx';
import { ConfirmDialog } from '../../components/organisms/store/ConfirmDialog.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Badge } from '../../components/atoms/Badge.tsx';
import { Button, IconButton } from '../../components/atoms/Button.tsx';
import { Hint, Input, Label, Select } from '../../components/atoms/Input.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

/**
 * Negocios (administrator / developer): every business of the order-taking assistant, each on its
 * own WhatsApp number. Create them, open any of them, switch them off, delete them.
 */
export function StoresAdminPage() {
  const api = useApi();
  const toast = useToast();
  const { data, error: loadError, reload } = useStores();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [kind, setKind] = useState<'sales' | 'services'>('sales');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  // The owner's login, shown once after creating the business.
  const [created, setCreated] = useState<{ storeName: string; loginId: string; password: string | null; existing: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(path: string, body: unknown, label: string) {
    setBusy(label);
    setError(null);
    try {
      const { id, access } = await api.post<{ id: number; access?: { loginId: string; created: boolean; temporaryPassword: string | null } | null }>(path, body);
      rememberStore(id);
      toast.success(label === 'demo' ? 'Negocio demo creado con catálogo, fotos y promociones.' : 'Negocio creado.');
      setCreating(false);
      if (access) setCreated({ storeName: name, loginId: access.loginId, password: access.temporaryPassword, existing: !access.created });
      setName('');
      setType('');
      setOwnerName('');
      setOwnerPhone('');
      if (!access) goTo(label === 'demo' ? 'store-test' : 'store-business');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(store: Store) {
    try {
      await api.patch(`/api/stores/${store.id}`, { active: !store.active });
      toast.success(store.active ? `${store.name} desactivado: no responde mensajes.` : `${store.name} activado.`);
      await reload();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function switchKind(store: Store) {
    const next = store.kind === 'services' ? 'sales' : 'services';
    try {
      await api.patch(`/api/stores/${store.id}`, { kind: next });
      toast.success(`${store.name} ahora es un negocio de ${next === 'services' ? 'servicios (citas)' : 'ventas (pedidos)'}.`);
      await reload();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const open = (store: Store, section: string) => {
    rememberStore(store.id);
    goTo(section);
  };
  const hasDemo = !!data?.stores.some((s) => s.is_demo);

  return (
    <Page
      title="Negocios"
      description="El asistente de pedidos: cada negocio atiende a sus clientes por su propio número de WhatsApp. Aquí los creas y les asignas sus administradores; ellos solo ven sus módulos de Pedidos."
      wide
      actions={
        <>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Nuevo negocio
          </Button>
          {!hasDemo && (
            <Button variant="secondary" loading={busy === 'demo'} onClick={() => void create('/api/stores/demo', {}, 'demo')}>
              <Sparkles size={16} /> Crear negocio demo
            </Button>
          )}
        </>
      }
    >
      {(error || loadError) && <Notice tone="error">{error ?? loadError}</Notice>}
      {data && !data.proofReading && (
        <Notice tone="info">Sin FAL_KEY en el servidor los comprobantes se adjuntan al pedido, pero no se leen automáticamente (valor, banco, referencia).</Notice>
      )}
      {!data ? (
        <Skeleton className="h-64" />
      ) : data.stores.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={36} className="text-primary" />}
          title="Aún no hay negocios"
          description="Crea el negocio demo para probar todo de una vez (una hamburguesería con 14 productos con foto y promociones para cada día), o crea uno desde cero."
          action={
            <Button loading={busy === 'demo'} onClick={() => void create('/api/stores/demo', {}, 'demo')}>
              Crear negocio demo
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-gray-medium/70 text-left text-xs font-semibold text-gray-dark dark:border-white/10">
                <th className="px-4 py-3">Negocio</th>
                <th className="px-4 py-3">WhatsApp</th>
                <th className="px-4 py-3 text-right">Productos</th>
                <th className="px-4 py-3 text-right">Por confirmar</th>
                <th className="px-4 py-3 text-right">Esperan persona</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.stores.map((s) => (
                <tr key={s.id} className="border-b border-gray-medium/60 last:border-b-0 dark:border-white/10">
                  <td className="px-4 py-3">
                    <button className="text-left font-bold text-ink hover:text-primary dark:text-white" onClick={() => open(s, 'store-orders')}>
                      {s.name}
                    </button>
                    <p className="text-xs text-gray-dark">{s.kind === 'services' ? 'Servicios' : 'Ventas'} · {s.business_type ?? 'Sin tipo'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-left" onClick={() => open(s, 'store-whatsapp')}>
                      <Badge tone={s.connection.connected ? 'success' : s.connection.linked ? 'warning' : 'neutral'}>
                        {s.connection.connected ? `+${s.connection.phone}` : s.connection.linked ? 'Desconectado' : 'Sin vincular'}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.products}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.pendingOrders || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.humanChats || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.active ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral">Desactivado</Badge>}
                      {!s.bot_enabled && <Badge tone="warning">Asistente apagado</Badge>}
                      {!!s.is_demo && <Badge tone="cyan">Demo</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => open(s, 'store-team')}>
                        Equipo
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void switchKind(s)}>
                        {s.kind === 'services' ? 'Pasar a ventas' : 'Pasar a servicios'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggle(s)}>
                        {s.active ? 'Desactivar' : 'Activar'}
                      </Button>
                      <IconButton label={`Borrar ${s.name}`} onClick={() => setDeleting(s)} className="hover:!text-error">
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title="Nuevo negocio" description="Después cargas el catálogo, la forma de atender y conectas su número." onClose={() => setCreating(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void create('/api/stores', { name, kind, business_type: type, owner: ownerPhone.trim() ? { name: ownerName, phone: ownerPhone } : undefined }, 'new');
            }}
          >
            <div>
              <Label htmlFor="n-kind">Tipo de negocio</Label>
              <Select id="n-kind" value={kind} onChange={(e) => setKind(e.target.value as 'sales' | 'services')}>
                <option value="sales">Ventas: vende productos y toma pedidos</option>
                <option value="services">Servicios: agenda citas (peluquería, clínica…)</option>
              </Select>
              <p className="mt-1.5 text-xs text-gray-dark">No es lo mismo: cada tipo tiene su asistente, su menú y sus pantallas.</p>
            </div>
            <div>
              <Label htmlFor="n-name">Nombre del negocio</Label>
              <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
            </div>
            <div>
              <Label htmlFor="n-type">Tipo de negocio</Label>
              <Input id="n-type" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} placeholder="Restaurante, tienda de ropa, droguería…" />
              <Hint>Ayuda al asistente a hablar como el negocio.</Hint>
            </div>
            <fieldset className="space-y-3 rounded-2xl border border-gray-medium/70 p-4 dark:border-white/10">
              <legend className="px-1 text-sm font-bold text-ink dark:text-white">Administrador del negocio</legend>
              <p className="text-sm text-gray-dark">Recibe su propio usuario para entrar al portal y ver solo su negocio. Tú puedes entrar a cualquier negocio en modo soporte.</p>
              <div>
                <Label htmlFor="o-name">Nombre</Label>
                <Input id="o-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={80} autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="o-phone">WhatsApp personal (con indicativo)</Label>
                <Input id="o-phone" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} inputMode="tel" placeholder="573001234567" autoComplete="off" />
                <Hint>Es su usuario de ingreso. Si lo dejas vacío, lo agregas después en Equipo.</Hint>
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={busy === 'new'} disabled={!name.trim()}>
                Crear negocio
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {created && <AccessCard info={created} onClose={() => { setCreated(null); goTo('store-business'); }} />}
      {deleting && (
        <ConfirmDialog
          title="Borrar el negocio"
          cta="Borrar para siempre"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.del(`/api/stores/${deleting.id}`);
              toast.success('Negocio borrado.');
              await reload();
            } catch (err) {
              setError(errMsg(err));
            }
            setDeleting(null);
          }}
        >
          Se borran <strong className="text-ink dark:text-white">{deleting.name}</strong>, su catálogo, fotos, pedidos y conversaciones, y se desvincula su WhatsApp. No se puede deshacer. Si solo quieres pausarlo, desactívalo.
        </ConfirmDialog>
      )}
    </Page>
  );
}

/** The business owner's login, shown once: copy it or send it by WhatsApp. */
function AccessCard({ info, onClose }: { info: { storeName: string; loginId: string; password: string | null; existing: boolean }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.origin;
  const text = info.password
    ? `Hola, ya tienes acceso a ${info.storeName} en Canix.
Ingresa en ${url}
Usuario: ${info.loginId}
Contraseña temporal: ${info.password}
Al entrar te pedirá crear tu propia contraseña.`
    : `Hola, ya puedes administrar ${info.storeName} en Canix. Ingresa en ${url} con tu usuario ${info.loginId} y tu contraseña de siempre.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text is selectable below */
    }
  }
  return (
    <Modal title="Negocio creado" description={info.existing ? 'Esa persona ya tenía usuario: ahora también administra este negocio.' : 'Estos datos se muestran una sola vez. Compártelos con su administrador.'} onClose={onClose}>
      <div className="space-y-4">
        <pre className="select-all whitespace-pre-wrap rounded-2xl bg-gray-light p-4 text-sm leading-relaxed text-ink dark:bg-white/5 dark:text-white">{text}</pre>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <a href={`https://wa.me/${info.loginId}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl bg-success px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Enviar por WhatsApp
          </a>
          <Button onClick={onClose}>Listo, configurar el negocio</Button>
        </div>
      </div>
    </Modal>
  );
}
