import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { Appointment, ProfessionalProfile, SchedGroup } from '../../lib/types.ts';
import { Page, Notice, Tabs } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label, Select } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Calendar, Legend, calendarRange, type CalendarView } from '../../components/scheduling/Calendar.tsx';
import { AppointmentDetail } from '../../components/scheduling/AppointmentDetail.tsx';
import { addDaysISO, addMonthsISO, todayISO } from '../../lib/dates.ts';

interface ProRow {
  user_id: number;
  name: string | null;
  phone: string;
  profile: ProfessionalProfile | null;
}

export function SchedulingAdminPage() {
  const [tab, setTab] = useState<'calendar' | 'groups'>('calendar');
  return (
    <Page
      title="Agendas generales"
      wide
      description="Agrupa profesionales (ej. un consultorio) para ver un calendario combinado y dar a un cliente acceso a agendar con cualquiera del grupo. Para que alguien sea profesional, asígnale el paquete 'Profesional de agenda' en Usuarios."
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'calendar', label: 'Calendario combinado' },
          { id: 'groups', label: 'Grupos' },
        ]}
      />
      {tab === 'calendar' ? <CombinedCalendar /> : <Groups />}
    </Page>
  );
}

function CombinedCalendar() {
  const api = useApi();
  const [groups, setGroups] = useState<SchedGroup[]>([]);
  const [pros, setPros] = useState<ProRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(todayISO());
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<SchedGroup[]>('/api/admin/scheduling/groups'), api.get<ProRow[]>('/api/admin/scheduling/professionals')])
      .then(([g, p]) => {
        setGroups(g);
        setPros(p);
      })
      .catch((e) => setError(errMsg(e)));
  }, [api]);

  const load = useCallback(() => {
    const { from, to } = calendarRange(view, anchor);
    const q = filter.startsWith('g:') ? `&groupId=${filter.slice(2)}` : filter.startsWith('p:') ? `&professionalId=${filter.slice(2)}` : '';
    api
      .get<{ appointments: Appointment[] }>(`/api/admin/scheduling/calendar?from=${from}&to=${to}${q}`)
      .then((r) => setAppts(r.appointments))
      .catch((e) => setError(errMsg(e)));
  }, [api, view, anchor, filter]);
  useEffect(load, [load]);

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" onClick={() => setAnchor(view === 'week' ? addDaysISO(anchor, -7) : addMonthsISO(anchor, -1))}>
            ←
          </Button>
          <Button variant="secondary" onClick={() => setAnchor(todayISO())}>
            Hoy
          </Button>
          <Button variant="secondary" onClick={() => setAnchor(view === 'week' ? addDaysISO(anchor, 7) : addMonthsISO(anchor, 1))}>
            →
          </Button>
          <Select value={view} onChange={(e) => setView(e.target.value as CalendarView)} style={{ width: 'auto' }}>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </Select>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">Todos los profesionales</option>
            {groups.map((g) => (
              <option key={g.id} value={`g:${g.id}`}>
                Grupo: {g.name}
              </option>
            ))}
            {pros.map((p) => (
              <option key={p.user_id} value={`p:${p.user_id}`}>
                {p.profile?.display_name ?? p.name}
              </option>
            ))}
          </Select>
        </div>
        <Legend />
      </div>
      <Card className="p-3">
        <Calendar view={view} anchor={anchor} appointments={appts} showProfessional onSelect={(a) => setSelected(a.id)} onDayClick={(d) => { setAnchor(d); setView('week'); }} />
      </Card>
      {selected && <AppointmentDetail id={selected} perspective="professional" onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}

function Groups() {
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

function ShareGroup({ group, onClose, onDone }: { group: SchedGroup; onClose: () => void; onDone: (msg: string) => void }) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      const r = await api.post<{ notified: boolean; forwardText: string | null }>(`/api/admin/scheduling/groups/${group.id}/clients`, { phone, name });
      onDone(r.notified ? 'Acceso dado y le escribí por WhatsApp.' : `Acceso dado, pero no pude escribirle. Reenvíale: "${r.forwardText}"`);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  return (
    <Modal title={`Dar acceso a "${group.name}"`} onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="mb-3 text-sm text-gray-dark">Podrá agendar con cualquier profesional del grupo (solo agendar).</p>
      <Label>Número (con indicativo)</Label>
      <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="573001234567" />
      <div className="h-3" />
      <Label>Nombre</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={!phone.trim()}>
          Dar acceso
        </Button>
      </div>
    </Modal>
  );
}
