import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Check, X, Share2 } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { Appointment, AvailabilityRule, ProfessionalProfile, SchedClient, Slot, TimeOff } from '../../lib/types.ts';
import { Page, Notice, Tabs } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label, Select } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Calendar, Legend, calendarRange, type CalendarView } from '../../components/scheduling/Calendar.tsx';
import { AppointmentDetail } from '../../components/scheduling/AppointmentDetail.tsx';
import { addDaysISO, addMonthsISO, formatWhen, todayISO, WEEKDAY_NAMES, time12, formatDayLong } from '../../lib/dates.ts';
import { useCreated } from '../../components/ui/Created.tsx';

type Tab = 'calendar' | 'requests' | 'schedule' | 'clients' | 'settings';

export function ProfessionalAgendaPage() {
  const api = useApi();
  const [tab, setTab] = useState<Tab>('calendar');
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [pending, setPending] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const r = await api.get<{ profile: ProfessionalProfile; availability: AvailabilityRule[]; time_off: TimeOff[] }>('/api/scheduling/pro/profile');
      setProfile(r.profile);
      setRules(r.availability);
      setTimeOff(r.time_off);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api]);

  const loadPending = useCallback(async () => {
    try {
      const r = await api.get<{ appointments: Appointment[] }>(`/api/scheduling/pro/calendar?from=${todayISO()}&to=${addDaysISO(todayISO(), 90)}`);
      setPending(r.appointments.filter((a) => a.status === 'pending'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api]);

  useEffect(() => {
    loadProfile();
    loadPending();
  }, [loadProfile, loadPending]);

  return (
    <Page title="Mi agenda" wide description={profile ? `${profile.display_name}${profile.specialty ? ` · ${profile.specialty}` : ''} · citas de ${profile.slot_minutes} min` : undefined}>
      {error && <Notice tone="error">{error}</Notice>}
      {profile && !rules.length && tab !== 'schedule' && (
        <Notice tone="info">
          Aún no tienes horario de atención, así que nadie puede pedirte citas.{' '}
          <button className="font-semibold underline" onClick={() => setTab('schedule')}>
            Defínelo aquí
          </button>
          .
        </Notice>
      )}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'calendar', label: 'Calendario' },
          { id: 'requests', label: `Solicitudes${pending.length ? ` (${pending.length})` : ''}` },
          { id: 'schedule', label: 'Horario y bloqueos' },
          { id: 'clients', label: 'Clientes' },
          { id: 'settings', label: 'Configuración' },
        ]}
      />
      {tab === 'calendar' && <CalendarTab timeOff={timeOff} onChanged={loadPending} />}
      {tab === 'requests' && <RequestsTab pending={pending} onChanged={loadPending} />}
      {tab === 'schedule' && <ScheduleTab rules={rules} timeOff={timeOff} onSaved={loadProfile} />}
      {tab === 'clients' && <ClientsTab />}
      {tab === 'settings' && profile && <SettingsTab profile={profile} onSaved={loadProfile} />}
    </Page>
  );
}

// ------------------------------------------------------------------ calendar
function CalendarTab({ timeOff, onChanged }: { timeOff: TimeOff[]; onChanged: () => void }) {
  const api = useApi();
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(todayISO());
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const { from, to } = calendarRange(view, anchor);
    api
      .get<{ appointments: Appointment[] }>(`/api/scheduling/pro/calendar?from=${from}&to=${to}`)
      .then((r) => setAppts(r.appointments))
      .catch((e) => setError(errMsg(e)));
  }, [api, view, anchor]);
  useEffect(load, [load]);

  const step = (dir: number) => setAnchor(view === 'week' ? addDaysISO(anchor, 7 * dir) : addMonthsISO(anchor, dir));

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button variant="secondary" onClick={() => step(-1)}>
            ←
          </Button>
          <Button variant="secondary" onClick={() => setAnchor(todayISO())}>
            Hoy
          </Button>
          <Button variant="secondary" onClick={() => step(1)}>
            →
          </Button>
          <Select value={view} onChange={(e) => setView(e.target.value as CalendarView)} style={{ width: 'auto' }}>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <Legend />
          <Button onClick={() => setCreating(anchor)}>
            <Plus size={16} /> Nueva cita
          </Button>
        </div>
      </div>
      <Card className="p-3">
        <Calendar
          view={view}
          anchor={anchor}
          appointments={appts}
          timeOff={timeOff}
          onSelect={(a) => setSelected(a.id)}
          onDayClick={(d) => {
            setAnchor(d);
            if (view === 'month') setView('week');
          }}
        />
      </Card>
      {selected && (
        <AppointmentDetail
          id={selected}
          perspective="professional"
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
      {creating && (
        <NewAppointment
          date={creating < todayISO() ? todayISO() : creating}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            load();
          }}
        />
      )}
    </>
  );
}

function NewAppointment({ date: initial, onClose, onCreated }: { date: string; onClose: () => void; onCreated: () => void }) {
  const api = useApi();
  const created = useCreated();
  const [clients, setClients] = useState<SchedClient[]>([]);
  const [clientId, setClientId] = useState<number | ''>('');
  const [date, setDate] = useState(initial);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SchedClient[]>('/api/scheduling/pro/clients').then(setClients).catch((e) => setError(errMsg(e)));
  }, [api]);
  useEffect(() => {
    setTime('');
    api.get<Slot[]>(`/api/scheduling/pro/slots?from=${date}&days=1`).then(setSlots).catch(() => setSlots([]));
  }, [api, date]);

  async function save() {
    setError(null);
    try {
      await api.post('/api/scheduling/pro/appointments', { clientId, start: `${date} ${time}`, duration_minutes: duration ? Number(duration) : undefined, reason });
      const client = clients.find((c) => c.id === clientId);
      created({
        kind: 'Cita agendada',
        title: client?.name ?? 'Cita',
        section: 'agenda',
        details: [`${formatDayLong(date)} · ${time12(`${date} ${time}`)}`, ...(reason ? [reason] : [])],
        sticker: 'evento',
        shareText: `📅 Tu cita quedó agendada para el ${formatDayLong(date)} a las ${time12(`${date} ${time}`)}.${reason ? `\nMotivo: ${reason}` : ''}`,
        sharePhone: client?.phone ?? null,
        sharePhoneLabel: client?.name ? `Avisarle a ${client.name}` : 'Avisarle al cliente',
      });
      onCreated();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Modal title="Agendar una cita" onClose={onClose} size="md">
      {error && <Notice tone="error">{error}</Notice>}
      {clients.length === 0 ? (
        <p className="text-sm text-gray-dark">Primero comparte acceso con un cliente (pestaña Clientes).</p>
      ) : (
        <>
          <Label>Cliente</Label>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Elige…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.phone} (+{c.phone})
              </option>
            ))}
          </Select>
          <div className="h-3" />
          <Label>Fecha</Label>
          <Input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="mb-1 mt-3 text-sm font-medium text-ink dark:text-white">Espacios libres ({formatDayLong(date)})</p>
          <div className="flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <button
                key={s.start_at}
                onClick={() => setTime(s.start_at.slice(11, 16))}
                className={`rounded-lg border px-2.5 py-1 text-sm ${time === s.start_at.slice(11, 16) ? 'border-primary bg-primary text-white' : 'border-gray-medium hover:border-primary dark:border-white/10'}`}
              >
                {time12(s.start_at)}
              </button>
            ))}
            {!slots.length && <p className="text-sm text-gray-dark">Sin espacios en tu horario ese día - puedes poner una hora manual.</p>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label>Hora (manual)</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Duración (min)</Label>
              <Input type="number" min={5} max={480} placeholder="la de tu agenda" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
          <div className="h-3" />
          <Label>Motivo (opcional)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="mt-2 text-xs text-gray-dark">Queda confirmada y le aviso al cliente por WhatsApp.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!clientId || !time}>
              Agendar
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ requests
function RequestsTab({ pending, onChanged }: { pending: Appointment[]; onChanged: () => void }) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const act = (path: string, body?: unknown) =>
    api
      .post(path, body)
      .then(onChanged)
      .catch((e) => setError(errMsg(e)));

  if (!pending.length) return <EmptyState icon="📭" title="No tienes solicitudes pendientes" description="Cuando un cliente pida una cita, aparece aquí y te aviso por WhatsApp." />;
  return (
    <div className="space-y-2">
      {error && <Notice tone="error">{error}</Notice>}
      {pending.map((a) => (
        <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <button className="min-w-0 text-left" onClick={() => setSelected(a.id)}>
            <p className="font-medium capitalize text-ink dark:text-white">{formatWhen(a.start_at)}</p>
            <p className="text-sm text-gray-dark">
              {a.client_name ?? 'Cliente'} (+{a.client_phone}){a.reason ? ` · ${a.reason}` : ''}
            </p>
          </button>
          <div className="flex gap-2">
            <Button onClick={() => act(`/api/scheduling/pro/appointments/${a.id}/confirm`)}>
              <Check size={15} /> Confirmar
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const reason = prompt('Motivo del rechazo (opcional):');
                if (reason !== null) act(`/api/scheduling/pro/appointments/${a.id}/reject`, { reason });
              }}
            >
              <X size={15} /> Rechazar
            </Button>
          </div>
        </Card>
      ))}
      {selected && <AppointmentDetail id={selected} perspective="professional" onClose={() => setSelected(null)} onChanged={onChanged} />}
    </div>
  );
}

// ------------------------------------------------------------------ schedule
function ScheduleTab({ rules, timeOff, onSaved }: { rules: AvailabilityRule[]; timeOff: TimeOff[]; onSaved: () => void }) {
  const api = useApi();
  const [draft, setDraft] = useState<AvailabilityRule[]>(rules);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [block, setBlock] = useState({ start: '', end: '', reason: '' });
  useEffect(() => setDraft(rules), [rules]);

  const order = [1, 2, 3, 4, 5, 6, 0];
  const update = (i: number, patch: Partial<AvailabilityRule>) => setDraft(draft.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    try {
      await api.put('/api/scheduling/pro/availability', { rules: draft.map((r) => ({ weekday: r.weekday, start: r.start_time, end: r.end_time })) });
      setMsg({ tone: 'success', text: 'Horario guardado.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  function copyMondayToWeekdays() {
    const monday = draft.filter((r) => r.weekday === 1);
    setDraft([...draft.filter((r) => ![2, 3, 4, 5].includes(r.weekday)), ...[2, 3, 4, 5].flatMap((wd) => monday.map((r) => ({ weekday: wd, start_time: r.start_time, end_time: r.end_time })))]);
  }

  async function addBlock() {
    try {
      await api.post('/api/scheduling/pro/time-off', { start: block.start.replace('T', ' '), end: block.end.replace('T', ' '), reason: block.reason });
      setBlock({ start: '', end: '', reason: '' });
      setMsg({ tone: 'success', text: 'Bloqueo agregado.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <Card className="p-4">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-display font-semibold text-ink dark:text-white">Horario semanal de atención</p>
          <Button variant="ghost" onClick={copyMondayToWeekdays}>
            Copiar lunes a mar-vie
          </Button>
        </div>
        <div className="space-y-3">
          {order.map((wd) => {
            const items = draft.map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === wd);
            return (
              <div key={wd} className="flex flex-wrap items-start gap-3 border-b border-gray-medium/50 pb-3 last:border-0 dark:border-white/5">
                <p className="w-24 pt-2 text-sm font-medium capitalize text-ink dark:text-white">{WEEKDAY_NAMES[wd]}</p>
                <div className="flex-1 space-y-2">
                  {!items.length && <p className="pt-2 text-sm text-gray-dark">No atiendo</p>}
                  {items.map(({ r, i }) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input type="time" value={r.start_time} onChange={(e) => update(i, { start_time: e.target.value })} />
                      <span className="text-gray-dark">a</span>
                      <Input type="time" value={r.end_time} onChange={(e) => update(i, { end_time: e.target.value })} />
                      <button className="text-gray-dark hover:text-error" onClick={() => setDraft(draft.filter((_, j) => j !== i))} aria-label="Quitar">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="pt-2 text-sm text-primary hover:underline" onClick={() => setDraft([...draft, { weekday: wd, start_time: '08:00', end_time: '12:00' }])}>
                  + bloque
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save}>Guardar horario</Button>
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-1 font-display font-semibold text-ink dark:text-white">Bloqueos (vacaciones, imprevistos)</p>
        <p className="mb-3 text-xs text-gray-dark">Nadie puede pedir citas en un bloqueo. No cancela citas que ya existan.</p>
        <Label>Desde</Label>
        <Input type="datetime-local" value={block.start} onChange={(e) => setBlock({ ...block, start: e.target.value })} />
        <div className="h-2" />
        <Label>Hasta</Label>
        <Input type="datetime-local" value={block.end} onChange={(e) => setBlock({ ...block, end: e.target.value })} />
        <div className="h-2" />
        <Label>Motivo</Label>
        <Input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} />
        <Button className="mt-3 w-full" variant="secondary" disabled={!block.start || !block.end} onClick={addBlock}>
          Agregar bloqueo
        </Button>
        <ul className="mt-4 space-y-2">
          {timeOff.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
              <span>
                {t.start_at.slice(0, 16)} → {t.end_at.slice(0, 16)}
                {t.reason && <span className="block text-xs text-gray-dark">{t.reason}</span>}
              </span>
              <button
                className="text-gray-dark hover:text-error"
                onClick={() =>
                  api
                    .del(`/api/scheduling/pro/time-off/${t.id}`)
                    .then(onSaved)
                    .catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))
                }
                aria-label="Quitar"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ clients
function ClientsTab() {
  const api = useApi();
  const [clients, setClients] = useState<SchedClient[] | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [forward, setForward] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(() => api.get<SchedClient[]>('/api/scheduling/pro/clients').then(setClients).catch((e) => setMsg({ tone: 'error', text: errMsg(e) })), [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function share() {
    setMsg(null);
    setForward(null);
    try {
      const r = await api.post<{ client: { name: string | null }; notified: boolean; forwardText: string | null }>('/api/scheduling/pro/clients', { phone, name });
      setMsg({ tone: 'success', text: r.notified ? `Listo, ${r.client.name ?? 'la persona'} ya puede agendar contigo y le escribí por WhatsApp.` : 'Acceso dado, pero no pude escribirle ahora. Reenvíale el mensaje de abajo.' });
      setForward(r.forwardText);
      setPhone('');
      setName('');
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
      <Card className="p-4">
        <p className="mb-1 font-display font-semibold text-ink dark:text-white">Dar acceso para agendar</p>
        <p className="mb-3 text-xs text-gray-dark">La persona solo podrá ver tus espacios disponibles, pedir citas (que tú confirmas) y ver las suyas. Nada más.</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {forward && <div className="mb-3 rounded-xl bg-gray-light p-3 text-sm dark:bg-white/5">{forward}</div>}
        <Label>Número de WhatsApp (con indicativo)</Label>
        <Input inputMode="tel" placeholder="573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="h-2" />
        <Label>Nombre</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button className="mt-3 w-full" disabled={!phone.trim()} onClick={share}>
          <Share2 size={15} /> Compartir acceso
        </Button>
      </Card>
      <div className="space-y-2">
        {clients?.length === 0 && <EmptyState icon="👥" title="Todavía nadie puede agendar contigo" />}
        {clients?.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-3 p-3">
            <div>
              <p className="font-medium text-ink dark:text-white">{c.name ?? '(sin nombre)'}</p>
              <p className="text-xs text-gray-dark">
                +{c.phone}
                {c.via_group ? ` · vía ${c.via_group}` : ''}
              </p>
            </div>
            {!c.via_group && (
              <Button
                variant="ghost"
                onClick={() =>
                  confirm(`¿Quitarle a ${c.name ?? c.phone} el acceso a agendar contigo? Sus citas existentes no se cancelan.`) &&
                  api
                    .del(`/api/scheduling/pro/clients/${c.id}`)
                    .then(load)
                    .catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))
                }
              >
                <Trash2 size={15} className="text-error" />
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings
function SettingsTab({ profile, onSaved }: { profile: ProfessionalProfile; onSaved: () => void }) {
  const api = useApi();
  const [f, setF] = useState({
    display_name: profile.display_name,
    specialty: profile.specialty ?? '',
    slot_minutes: String(profile.slot_minutes),
    buffer_minutes: String(profile.buffer_minutes),
    min_notice_hours: String(Math.round(profile.min_notice_minutes / 60)),
    max_days_ahead: String(profile.max_days_ahead),
    reminder_morning_time: profile.reminder_morning_time ?? '',
    reminder_hours_before: profile.reminder_hours_before ? String(profile.reminder_hours_before) : '',
    auto_confirm: !!profile.auto_confirm,
  });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function save() {
    try {
      await api.put('/api/scheduling/pro/settings', {
        display_name: f.display_name,
        specialty: f.specialty,
        slot_minutes: Number(f.slot_minutes),
        buffer_minutes: Number(f.buffer_minutes),
        min_notice_minutes: Number(f.min_notice_hours) * 60,
        max_days_ahead: Number(f.max_days_ahead),
        reminder_morning_time: f.reminder_morning_time || null,
        reminder_hours_before: f.reminder_hours_before ? Number(f.reminder_hours_before) : null,
        auto_confirm: f.auto_confirm,
      });
      setMsg({ tone: 'success', text: 'Configuración guardada.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  const field = (key: keyof typeof f, label: string, props: Record<string, unknown> = {}, help?: string) => (
    <div>
      <Label>{label}</Label>
      <Input value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} />
      {help && <p className="mt-1 text-xs text-gray-dark">{help}</p>}
    </div>
  );

  return (
    <Card className="max-w-2xl p-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('display_name', 'Nombre que ven tus clientes')}
        {field('specialty', 'Especialidad', { placeholder: 'Ej. Psicología' })}
        {field('slot_minutes', 'Duración de cada cita (min)', { type: 'number', min: 5, max: 480 })}
        {field('buffer_minutes', 'Descanso entre citas (min)', { type: 'number', min: 0, max: 240 })}
        {field('min_notice_hours', 'Anticipación mínima (horas)', { type: 'number', min: 0 }, 'No se pueden pedir citas con menos tiempo que esto.')}
        {field('max_days_ahead', 'Hasta cuántos días adelante', { type: 'number', min: 1, max: 365 })}
        {field('reminder_morning_time', 'Recordatorio el día de la cita a las', { type: 'time' }, 'Vacío = sin este recordatorio. Si la cita es antes de esa hora, se avisa la noche anterior.')}
        {field('reminder_hours_before', 'Recordatorio extra (horas antes)', { type: 'number', min: 1, max: 72, placeholder: 'Opcional' })}
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.auto_confirm} onChange={(e) => setF({ ...f, auto_confirm: e.target.checked })} />
        <span>
          Confirmar automáticamente las solicitudes
          <span className="block text-xs text-gray-dark">Si lo apagas (recomendado), cada cita que pidan queda pendiente hasta que la apruebes.</span>
        </span>
      </label>
      <p className="mt-3 text-xs text-gray-dark">Los recordatorios les llegan a ti y a tu cliente por WhatsApp.</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={save}>Guardar configuración</Button>
      </div>
    </Card>
  );
}
