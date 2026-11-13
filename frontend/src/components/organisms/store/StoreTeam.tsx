import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { errMsg, useApi } from '../../../services/api.ts';
import { useAuth } from '../../../services/auth.tsx';
import type { Store, StoreMember } from '../../../types/store.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { Avatar } from '../../atoms/Avatar.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button, IconButton } from '../../atoms/Button.tsx';
import { Hint, Input, Label } from '../../atoms/Input.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

/**
 * The people who manage the business. The administrator adds them (they get a portal account that
 * only sees this business); everyone decides whether they get the WhatsApp notices.
 */
export function StoreTeam({ store }: { store: Store }) {
  const api = useApi();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const base = `/api/stores/${store.id}/members`;
  const [members, setMembers] = useState<StoreMember[] | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [credentials, setCredentials] = useState<{ loginId: string; password: string } | null>(null);
  const [removing, setRemoving] = useState<StoreMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await api.get<StoreMember[]>(base));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base]);
  useEffect(() => void load(), [load]);

  async function add() {
    setAdding(true);
    setError(null);
    try {
      const res = await api.post<{ temporaryPassword: string | null; loginId: string }>(base, { phone, name });
      setCredentials(res.temporaryPassword ? { loginId: res.loginId, password: res.temporaryPassword } : null);
      toast.success(res.temporaryPassword ? 'Agregado. Comparte sus datos de ingreso.' : 'Agregado. Entra con la contraseña que ya tenía.');
      setPhone('');
      setName('');
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setAdding(false);
    }
  }

  async function toggleNotify(m: StoreMember) {
    try {
      await api.patch(`${base}/${m.id}`, { notify: !m.notify });
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-[15rem_1fr]">
      <div>
        <h2 className="text-base font-extrabold text-ink dark:text-white">Equipo del negocio</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-dark">
          Reciben por WhatsApp los pedidos nuevos, los comprobantes y los clientes que piden una persona. Pueden confirmar un pedido reaccionando 👍 al aviso.
        </p>
      </div>
      <div className="max-w-2xl space-y-5">
        {error && <Notice tone="error">{error}</Notice>}
        {credentials && (
          <Notice tone="success">
            Datos de ingreso al portal (se muestran una sola vez): número <strong className="tabular-nums">{credentials.loginId}</strong> · contraseña temporal{' '}
            <strong className="font-mono tabular-nums">{credentials.password}</strong>. Al entrar, el portal le pide crear la suya. Solo verá este negocio.
          </Notice>
        )}
        {!members ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white dark:border-white/10 dark:bg-[var(--surface)]">
            {members.length === 0 && <li className="px-4 py-4 text-sm text-gray-dark">Nadie recibe los avisos todavía.</li>}
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 border-b border-gray-medium/60 px-4 py-3 last:border-b-0 dark:border-white/10">
                <Avatar name={m.name} seed={m.id} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink dark:text-white">
                    {m.name ?? 'Sin nombre'} {m.id === user?.id && <span className="font-normal text-gray-dark">(tú)</span>}
                  </p>
                  <p className="text-xs tabular-nums text-gray-dark">+{m.phone}</p>
                </div>
                {m.role === 'admin' && <Badge tone="brand">Administrador</Badge>}
                {!m.hasPassword && <Badge tone="warning">Sin contraseña</Badge>}
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-dark">
                  <input type="checkbox" checked={m.notify} disabled={!isAdmin && m.id !== user?.id} onChange={() => void toggleNotify(m)} className="h-4 w-4 accent-[var(--color-primary)]" />
                  Avisos por WhatsApp
                </label>
                {isAdmin && (
                  <IconButton label={`Quitar a ${m.name ?? m.phone}`} onClick={() => setRemoving(m)} className="hover:!text-error">
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <form
            className="rounded-2xl border border-gray-medium/70 bg-white p-4 dark:border-white/10 dark:bg-[var(--surface)]"
            onSubmit={(e) => {
              e.preventDefault();
              if (phone.replace(/\D/g, '').length >= 7) void add();
            }}
          >
            <p className="mb-3 text-sm font-bold text-ink dark:text-white">Agregar administrador del negocio</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="m-phone">WhatsApp</Label>
                <Input id="m-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="573001234567" required />
              </div>
              <div>
                <Label htmlFor="m-name">Nombre</Label>
                <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Opcional" />
              </div>
              <Button type="submit" loading={adding} disabled={phone.replace(/\D/g, '').length < 7}>
                Agregar
              </Button>
            </div>
            <Hint>Si no tiene cuenta en Canix, se le crea una que solo ve los módulos de Pedidos de este negocio.</Hint>
          </form>
        )}
      </div>
      {removing && (
        <ConfirmDialog
          title="Quitar del equipo"
          cta="Quitar"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await api.del(`${base}/${removing.id}`);
              await load();
            } catch (err) {
              setError(errMsg(err));
            }
            setRemoving(null);
          }}
        >
          <strong className="text-ink dark:text-white">{removing.name ?? `+${removing.phone}`}</strong> deja de ver este negocio y de recibir sus avisos. Su cuenta de Canix no se borra.
        </ConfirmDialog>
      )}
    </div>
  );
}
