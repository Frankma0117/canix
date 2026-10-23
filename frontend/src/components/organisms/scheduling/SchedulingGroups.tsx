import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { SchedGroup } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { ShareGroup } from './ShareGroup.tsx';
import { ProRow } from '../../../types/scheduling-admin.ts';

export function SchedulingGroups() {
  const api = useApi();
  const [groups, setGroups] = useState<SchedGroup[] | null>(null);
  const [pros, setPros] = useState<ProRow[]>([]);
  const [editing, setEditing] = useState<{ id?: number; name: string; description: string; members: number[] } | null>(null);
  const [sharing, setSharing] = useState<SchedGroup | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.get<SchedGroup[]>('/api/admin/scheduling/groups'), api.get<ProRow[]>('/api/admin/scheduling/professionals')])
        .then(([g, p]) => {
          setGroups(g);
          setPros(p);
        })
        .catch((e) => setMsg({ tone: 'error', text: errMsg(e) })),
    [api],
  );
  useEffect(() => {
    load();
  }, [load]);

  const proName = (id: number) => {
    const p = pros.find((x) => x.user_id === id);
    return p?.profile?.display_name ?? p?.name ?? `#${id}`;
  };

  async function save() {
    if (!editing) return;
    try {
      if (editing.id) await api.put(`/api/admin/scheduling/groups/${editing.id}`, editing);
      else {
        const { id } = await api.post<{ id: number }>('/api/admin/scheduling/groups', editing);
        if (editing.members.length) await api.put(`/api/admin/scheduling/groups/${id}`, { members: editing.members });
      }
      setEditing(null);
      setMsg({ tone: 'success', text: 'Grupo guardado.' });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  return (
    <>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({ name: '', description: '', members: [] })}>
          <Plus size={16} /> Nuevo grupo
        </Button>
      </div>
      {groups?.length === 0 && <EmptyState icon="🏥" title="Aún no hay agendas generales" />}
      <div className="grid gap-3 md:grid-cols-2">
        {groups?.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-semibold text-ink dark:text-white">{g.name}</p>
                {g.description && <p className="text-sm text-gray-dark">{g.description}</p>}
              </div>
              <div className="flex gap-1">
                <button className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60" onClick={() => setEditing({ id: g.id, name: g.name, description: g.description, members: g.members })} aria-label="Editar">
                  <Pencil size={15} />
                </button>
                <button
                  className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                  onClick={() => confirm(`¿Borrar "${g.name}"? Los clientes que tenían acceso solo por este grupo lo pierden.`) && api.del(`/api/admin/scheduling/groups/${g.id}`).then(load).catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))}
                  aria-label="Borrar"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs font-medium uppercase text-gray-dark">Profesionales</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {g.members.map((id) => (
                <Badge key={id} tone="info">
                  {proName(id)}
                </Badge>
              ))}
              {!g.members.length && <span className="text-xs text-gray-dark">Ninguno</span>}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase text-gray-dark">Clientes ({g.clients.length})</p>
              <Button variant="ghost" onClick={() => setSharing(g)}>
                <UserPlus size={15} /> Agregar
              </Button>
            </div>
            <ul className="space-y-0.5 text-sm">
              {g.clients.map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <span>
                    {c.name ?? '(sin nombre)'} <span className="text-xs text-gray-dark">+{c.phone}</span>
                  </span>
                  <button className="text-xs text-gray-dark hover:text-error" onClick={() => api.del(`/api/admin/scheduling/groups/${g.id}/clients/${c.id}`).then(load)}>
                    quitar
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Editar grupo' : 'Nuevo grupo'} onClose={() => setEditing(null)} size="md">
          <Label>Nombre</Label>
          <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <div className="h-3" />
          <Label>Descripción</Label>
          <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <p className="mb-1 mt-4 text-sm font-medium text-ink dark:text-white">Profesionales del grupo</p>
          {!pros.length && <p className="text-sm text-gray-dark">No hay profesionales todavía (asigna el paquete "Profesional de agenda" a alguien).</p>}
          {pros.map((p) => (
            <label key={p.user_id} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={editing.members.includes(p.user_id)}
                onChange={() => setEditing({ ...editing, members: editing.members.includes(p.user_id) ? editing.members.filter((x) => x !== p.user_id) : [...editing.members, p.user_id] })}
              />
              {p.profile?.display_name ?? p.name} <span className="text-xs text-gray-dark">+{p.phone}</span>
            </label>
          ))}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!editing.name.trim()}>
              Guardar
            </Button>
          </div>
        </Modal>
      )}
      {sharing && <ShareGroup group={sharing} onClose={() => setSharing(null)} onDone={(t) => { setSharing(null); setMsg({ tone: 'success', text: t }); load(); }} />}
    </>
  );
}
