import { useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
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
import { Hint, Input, Label } from '../../components/atoms/Input.tsx';
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
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(path: string, body: unknown, label: string) {
    setBusy(label);
    setError(null);
    try {
      const { id } = await api.post<{ id: number }>(path, body);
      rememberStore(id);
      toast.success(label === 'demo' ? 'Negocio demo creado con catálogo, fotos y promociones.' : 'Negocio creado.');
      setCreating(false);
      setName('');
      setType('');
      goTo(label === 'demo' ? 'store-bot?tab=test' : 'store-bot?tab=business');
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
                    <p className="text-xs text-gray-dark">{s.business_type ?? 'Sin tipo'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-left" onClick={() => open(s, 'store-bot?tab=whatsapp')}>
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
                      <Button size="sm" variant="ghost" onClick={() => open(s, 'store-bot?tab=team')}>
                        Equipo
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
              if (name.trim()) void create('/api/stores', { name, business_type: type }, 'new');
            }}
          >
            <div>
              <Label htmlFor="n-name">Nombre del negocio</Label>
              <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
            </div>
            <div>
              <Label htmlFor="n-type">Tipo de negocio</Label>
              <Input id="n-type" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} placeholder="Restaurante, tienda de ropa, droguería…" />
              <Hint>Ayuda al asistente a hablar como el negocio.</Hint>
            </div>
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
