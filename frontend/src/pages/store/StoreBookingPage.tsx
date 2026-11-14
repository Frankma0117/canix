import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Plus, Trash2, UserX, X } from 'lucide-react';
import { errMsg, useApi } from '../../services/api.ts';
import { usePolling } from '../../services/store.tsx';
import type { BookingAppointment, BookingService, CatalogResponse, KnowledgeEntry, StaffHour, StaffMember, Store } from '../../types/store.ts';
import { WEEKDAY_NAMES } from '../../utils/dates.ts';
import { money } from '../../utils/store.ts';
import { StoreFrame } from '../../components/organisms/store/StoreFrame.tsx';
import { ConfirmDialog } from '../../components/organisms/store/ConfirmDialog.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Badge, type Tone } from '../../components/atoms/Badge.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Input, Label, Select, Textarea } from '../../components/atoms/Input.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

type TabId = 'agenda' | 'team' | 'services' | 'knowledge';

/** Citas: for businesses that sell services - the agenda, the people who attend, which products are bookable, and what the assistant knows. */
export function StoreBookingPage() {
  return (
    <StoreFrame title="Citas" description="Lo que tus clientes agendan por WhatsApp: la agenda, tu equipo con sus horarios, los servicios y lo que el asistente sabe del negocio.">
      {(store) => <Booking store={store} />}
    </StoreFrame>
  );
}

function Booking({ store }: { store: Store }) {
  const [tab, setTab] = useState<TabId>('agenda');
  return (
    <div className="space-y-5">
      <Tabs
        tabs={[
          { id: 'agenda', label: 'Agenda' },
          { id: 'team', label: 'Equipo' },
          { id: 'services', label: 'Servicios' },
          { id: 'knowledge', label: 'Conocimiento' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'agenda' && <Agenda store={store} />}
      {tab === 'team' && <Team store={store} />}
      {tab === 'services' && <Services store={store} />}
      {tab === 'knowledge' && <Knowledge store={store} />}
    </div>
  );
}

const STATUS: Record<BookingAppointment['status'], { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmada', tone: 'info' },
  completed: { label: 'Atendida', tone: 'success' },
  no_show: { label: 'No asistió', tone: 'warning' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

const hhmm = (at: string) => at.slice(11, 16);
const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};
const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const plusDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- agenda
function Agenda({ store }: { store: Store }) {
  const api = useApi();
  const toast = useToast();
  const base = `/api/stores/${store.id}/booking`;
  const [days, setDays] = useState(7);
  const [items, setItems] = useState<BookingAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<BookingAppointment | null>(null);

  const load = useCallback(async () => {
    const from = todayLocal();
    try {
      setItems((await api.get<{ appointments: BookingAppointment[] }>(`${base}/appointments?from=${from}&to=${plusDays(from, days)}`)).appointments);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base, days]);
  usePolling(load, 30_000, [load]);

  async function setStatus(a: BookingAppointment, status: BookingAppointment['status'], done: string) {
    try {
      await api.patch(`${base}/appointments/${a.id}`, { status });
      toast.success(done);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const byDay = new Map<string, BookingAppointment[]>();
  for (const a of items ?? []) (byDay.get(a.start_at.slice(0, 10)) ?? byDay.set(a.start_at.slice(0, 10), []).get(a.start_at.slice(0, 10))!).push(a);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label htmlFor="agenda-days">Mostrar</Label>
        <Select id="agenda-days" className="max-w-[14rem]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Próximos 7 días</option>
          <option value={14}>Próximos 14 días</option>
          <option value={30}>Próximos 30 días</option>
        </Select>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!items ? (
        <Skeleton className="h-32" />
      ) : !items.length ? (
        <EmptyState icon={<CalendarDays size={22} />} title="Sin citas en este rango" description="Cuando un cliente agende por WhatsApp, aparece aquí y te llega un aviso." />
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className="space-y-2">
            <h3 className="text-sm font-bold capitalize text-ink dark:text-white">{dayLabel(day)}</h3>
            {list.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-medium bg-white p-3.5 dark:border-white/10 dark:bg-white/5">
                <div className="w-24 shrink-0 text-sm font-bold tabular-nums text-ink dark:text-white">
                  {hhmm(a.start_at)} – {hhmm(a.end_at)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink dark:text-white">
                    {a.service_name} · {a.staff_name}
                  </p>
                  <p className="truncate text-xs text-gray-dark">
                    {a.customer_name ?? 'Cliente'}
                    {a.customer_phone ? ` · +${a.customer_phone}` : ''}
                    {a.notes ? ` · ${a.notes}` : ''}
                  </p>
                </div>
                <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                {a.status === 'confirmed' && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="soft" onClick={() => setStatus(a, 'completed', 'Marcada como atendida.')}>
                      <Check size={14} /> Atendida
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(a, 'no_show', 'Marcada como no asistió.')}>
                      <UserX size={14} /> No asistió
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDoomed(a)}>
                      <X size={14} /> Cancelar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </section>
        ))
      )}
      {doomed && (
        <ConfirmDialog
          title="¿Cancelar esta cita?"
          cta="Cancelar cita"
          onCancel={() => setDoomed(null)}
          onConfirm={async () => {
            await setStatus(doomed, 'cancelled', 'Cita cancelada.');
            setDoomed(null);
          }}
        >
          {doomed.service_name} con {doomed.staff_name}, {dayLabel(doomed.start_at.slice(0, 10))} a las {hhmm(doomed.start_at)}. El cliente no recibe aviso automático: escríbele desde Conversaciones.
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- team
function Team({ store }: { store: Store }) {
  const api = useApi();
  const toast = useToast();
  const base = `/api/stores/${store.id}/booking`;
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [services, setServices] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get<{ staff: StaffMember[] }>(`${base}/staff`), api.get<CatalogResponse>(`/api/stores/${store.id}/catalog`)]);
      setStaff(s.staff);
      setServices(c.products.map((p) => ({ id: p.id, name: p.name })));
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base, store.id]);
  useEffect(() => void load(), [load]);

  async function add() {
    try {
      await api.post(`${base}/staff`, { name, specialty });
      setName('');
      setSpecialty('');
      toast.success('Persona agregada. Ahora dale un horario.');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-medium bg-white p-4 dark:border-white/10 dark:bg-white/5">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="staff-name">Nombre</Label>
          <Input id="staff-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ej. Luz" />
        </div>
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="staff-spec">Especialidad (opcional)</Label>
          <Input id="staff-spec" value={specialty} maxLength={80} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ej. Colorista" />
        </div>
        <Button onClick={add} disabled={!name.trim()}>
          <Plus size={16} /> Agregar
        </Button>
      </div>
      {!staff ? (
        <Skeleton className="h-32" />
      ) : !staff.length ? (
        <EmptyState icon={<CalendarDays size={22} />} title="Aún no hay personas" description="Agrega a quienes atienden. Sin personas con horario, el asistente no puede agendar." />
      ) : (
        staff.map((m) => <StaffCard key={m.id} member={m} services={services} base={base} onSaved={load} />)
      )}
    </div>
  );
}

function StaffCard({ member, services, base, onSaved }: { member: StaffMember; services: { id: number; name: string }[]; base: string; onSaved: () => Promise<void> }) {
  const api = useApi();
  const toast = useToast();
  const [hours, setHours] = useState<StaffHour[]>(member.hours.map((h) => ({ weekday: h.weekday, start_time: h.start_time, end_time: h.end_time })));
  const [only, setOnly] = useState<number[]>(member.service_ids);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchHour = (i: number, p: Partial<StaffHour>) => setHours((hs) => hs.map((h, j) => (j === i ? { ...h, ...p } : h)));

  async function save(extra: object = {}, done = 'Cambios guardados.') {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`${base}/staff/${member.id}`, { hours, service_ids: only, ...extra });
      toast.success(done);
      await onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`space-y-4 rounded-2xl border border-gray-medium bg-white p-4 dark:border-white/10 dark:bg-white/5 ${member.active ? '' : 'opacity-70'}`}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-ink dark:text-white">{member.name}</p>
          {member.specialty && <p className="text-xs text-gray-dark">{member.specialty}</p>}
        </div>
        {!member.active && <Badge tone="neutral">Inactiva</Badge>}
        <Button size="sm" variant="ghost" onClick={() => save({ active: !member.active }, member.active ? 'Persona desactivada.' : 'Persona activada.')}>
          {member.active ? 'Desactivar' : 'Activar'}
        </Button>
      </header>
      {error && <Notice tone="error">{error}</Notice>}

      <div>
        <p className="mb-2 text-sm font-semibold text-ink dark:text-white">Horario semanal</p>
        <div className="space-y-2">
          {WEEKDAY_NAMES.map((dayName, weekday) => {
            const rows = hours.map((h, i) => ({ h, i })).filter((x) => x.h.weekday === weekday);
            return (
              <div key={weekday} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm capitalize text-ink dark:text-white/85">{dayName}</span>
                {!rows.length && <span className="text-xs text-gray-dark">No atiende</span>}
                {rows.map(({ h, i }) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    <Input type="time" aria-label={`${dayName} desde`} className="w-28" value={h.start_time} onChange={(e) => patchHour(i, { start_time: e.target.value })} />
                    <span className="text-gray-dark">a</span>
                    <Input type="time" aria-label={`${dayName} hasta`} className="w-28" value={h.end_time} onChange={(e) => patchHour(i, { end_time: e.target.value })} />
                    <Button size="sm" variant="ghost" aria-label="Quitar franja" onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </Button>
                  </span>
                ))}
                <Button size="sm" variant="soft" onClick={() => setHours((hs) => [...hs, { weekday, start_time: '09:00', end_time: '17:00' }])}>
                  <Plus size={14} /> Franja
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold text-ink dark:text-white">Servicios que hace</p>
        <p className="mb-2 text-xs text-gray-dark">Si no marcas ninguno, hace todos los servicios.</p>
        <div className="flex flex-wrap gap-2">
          {services.map((s) => {
            const on = only.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setOnly((o) => (on ? o.filter((x) => x !== s.id) : [...o, s.id]))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${on ? 'bg-primary text-white ring-primary' : 'bg-white text-ink ring-gray-medium dark:bg-white/5 dark:text-white/85 dark:ring-white/10'}`}
              >
                {s.name}
              </button>
            );
          })}
          {!services.length && <span className="text-xs text-gray-dark">Primero marca productos como servicio en la pestaña Servicios.</span>}
        </div>
      </div>

      <Button onClick={() => save()} loading={busy}>
        Guardar horario y servicios
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------- services
function Services({ store }: { store: Store }) {
  const api = useApi();
  const base = `/api/stores/${store.id}/booking`;
  const [products, setProducts] = useState<{ id: number; name: string; price: number }[] | null>(null);
  const [durations, setDurations] = useState<Map<number, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.get<CatalogResponse>(`/api/stores/${store.id}/catalog`), api.get<{ services: BookingService[] }>(`${base}/services`)]);
      setProducts(c.products.map((p) => ({ id: p.id, name: p.name, price: p.price })));
      setDurations(new Map(s.services.map((x) => [x.id, x.duration_min])));
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base, store.id]);
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-dark">Marca la duración en minutos de los productos que se agendan. Los que dejes vacíos siguen siendo productos normales del catálogo.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {!products ? (
        <Skeleton className="h-32" />
      ) : !products.length ? (
        <EmptyState icon={<CalendarDays size={22} />} title="Aún no hay productos" description="Crea los servicios como productos en Catálogo (nombre, precio y descripción) y vuelve aquí a ponerles la duración." />
      ) : (
        products.map((p) => <ServiceRow key={p.id} product={p} minutes={durations.get(p.id) ?? null} base={base} onSaved={load} />)
      )}
    </div>
  );
}

function ServiceRow({ product, minutes, base, onSaved }: { product: { id: number; name: string; price: number }; minutes: number | null; base: string; onSaved: () => Promise<void> }) {
  const api = useApi();
  const toast = useToast();
  const [value, setValue] = useState(minutes ? String(minutes) : '');
  const [error, setError] = useState<string | null>(null);
  const changed = value !== (minutes ? String(minutes) : '');

  async function save() {
    setError(null);
    try {
      await api.put(`${base}/services/${product.id}`, { duration_min: value.trim() ? Number(value) : null });
      toast.success(value.trim() ? 'Servicio guardado.' : 'Ya no se agenda como servicio.');
      await onSaved();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-medium bg-white p-3.5 dark:border-white/10 dark:bg-white/5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink dark:text-white">{product.name}</p>
        <p className="text-xs text-gray-dark">{money(product.price)}</p>
      </div>
      {minutes && <Badge tone="success">Se agenda</Badge>}
      <Input type="number" min={5} max={600} step={5} className="w-28" aria-label={`Duración de ${product.name} en minutos`} placeholder="minutos" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button size="sm" variant="soft" disabled={!changed} onClick={save}>
        Guardar
      </Button>
      {error && <p className="w-full text-xs text-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- knowledge
function Knowledge({ store }: { store: Store }) {
  const api = useApi();
  const toast = useToast();
  const base = `/api/stores/${store.id}/booking/knowledge`;
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [doomed, setDoomed] = useState<KnowledgeEntry | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries((await api.get<{ entries: KnowledgeEntry[] }>(base)).entries);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base]);
  useEffect(() => void load(), [load]);

  async function add() {
    try {
      await api.post(base, { title, content });
      setTitle('');
      setContent('');
      toast.success('Información guardada.');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-dark">Lo que el asistente puede responder sin inventar: políticas de cancelación, cuidados después del servicio, métodos de pago, preguntas frecuentes.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="space-y-3 rounded-2xl border border-gray-medium bg-white p-4 dark:border-white/10 dark:bg-white/5">
        <div>
          <Label htmlFor="kn-title">Tema</Label>
          <Input id="kn-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Cancelaciones" />
        </div>
        <div>
          <Label htmlFor="kn-content">Respuesta</Label>
          <Textarea id="kn-content" rows={3} value={content} maxLength={2000} onChange={(e) => setContent(e.target.value)} placeholder="Ej. Puedes cancelar hasta 2 horas antes sin costo." />
        </div>
        <Button onClick={add} disabled={!title.trim() || !content.trim()}>
          <Plus size={16} /> Agregar
        </Button>
      </div>
      {!entries ? (
        <Skeleton className="h-24" />
      ) : (
        entries.map((k) => (
          <div key={k.id} className="flex items-start gap-3 rounded-2xl border border-gray-medium bg-white p-3.5 dark:border-white/10 dark:bg-white/5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink dark:text-white">{k.title}</p>
              <p className="whitespace-pre-wrap text-sm text-gray-dark">{k.content}</p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Borrar ${k.title}`} onClick={() => setDoomed(k)}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))
      )}
      {doomed && (
        <ConfirmDialog
          title="¿Borrar esta información?"
          cta="Borrar"
          onCancel={() => setDoomed(null)}
          onConfirm={async () => {
            try {
              await api.del(`${base}/${doomed.id}`);
              toast.success('Información borrada.');
              await load();
            } catch (err) {
              setError(errMsg(err));
            }
            setDoomed(null);
          }}
        >
          «{doomed.title}» dejará de estar disponible para el asistente.
        </ConfirmDialog>
      )}
    </div>
  );
}
