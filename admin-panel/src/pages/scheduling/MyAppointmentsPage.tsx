import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { Appointment, Slot } from '../../lib/types.ts';
import { Page, Notice, Tabs } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label, Select } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { AppointmentDetail } from '../../components/scheduling/AppointmentDetail.tsx';
import { STATUS_STYLE } from '../../components/scheduling/Calendar.tsx';
import { addDaysISO, formatDayLong, formatWhen, nowWall, time12, todayISO } from '../../lib/dates.ts';

interface Prof {
  id: number;
  name: string;
  specialty: string | null;
  slot_minutes: number;
}

export function MyAppointmentsPage() {
  const api = useApi();
  const [tab, setTab] = useState<'mine' | 'book'>('mine');
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.get<Appointment[]>('/api/scheduling/client/appointments').then(setAppts).catch((e) => setError(errMsg(e))), [api]);
  useEffect(() => {
    load();
  }, [load]);

  const now = nowWall();
  const upcoming = (appts ?? []).filter((a) => a.end_at >= now && (a.status === 'pending' || a.status === 'confirmed'));
  const past = (appts ?? []).filter((a) => !upcoming.includes(a)).reverse();

  return (
    <Page title="Mis citas" description="Las citas que pides quedan pendientes hasta que el profesional las confirma; te aviso por WhatsApp.">
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'mine', label: 'Mis citas' },
          { id: 'book', label: 'Pedir una cita' },
        ]}
      />
      {tab === 'mine' && (
        <>
          {appts && !upcoming.length && <EmptyState icon="📅" title="No tienes citas próximas" action={<Button onClick={() => setTab('book')}>Pedir una cita</Button>} />}
          <div className="space-y-2">
            {upcoming.map((a) => (
              <AppointmentRow key={a.id} a={a} onClick={() => setSelected(a.id)} />
            ))}
          </div>
          {past.length > 0 && (
            <>
              <p className="mb-2 mt-6 text-sm font-medium text-gray-dark">Anteriores</p>
              <div className="space-y-2 opacity-80">
                {past.slice(0, 20).map((a) => (
                  <AppointmentRow key={a.id} a={a} onClick={() => setSelected(a.id)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {tab === 'book' && (
        <BookAppointment
          onBooked={() => {
            load();
            setTab('mine');
          }}
        />
      )}
      {selected && <AppointmentDetail id={selected} perspective="client" onClose={() => setSelected(null)} onChanged={load} />}
    </Page>
  );
}

function AppointmentRow({ a, onClick }: { a: Appointment; onClick: () => void }) {
  return (
    <Card className="flex cursor-pointer items-center justify-between gap-3 p-4 hover:border-primary/50" onClick={onClick}>
      <div className="min-w-0">
        <p className="font-medium capitalize text-ink dark:text-white">{formatWhen(a.start_at)}</p>
        <p className="text-sm text-gray-dark">
          {a.professional_name}
          {a.reason ? ` · ${a.reason}` : ''}
        </p>
      </div>
      <span className={`shrink-0 rounded border-l-2 px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>{a.status_label}</span>
    </Card>
  );
}

function BookAppointment({ onBooked }: { onBooked: () => void }) {
  const api = useApi();
  const [profs, setProfs] = useState<Prof[] | null>(null);
  const [profId, setProfId] = useState<number | ''>('');
  const [from, setFrom] = useState(todayISO());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [choice, setChoice] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<Prof[]>('/api/scheduling/client/professionals')
      .then((p) => {
        setProfs(p);
        if (p.length === 1) setProfId(p[0].id);
      })
      .catch((e) => setError(errMsg(e)));
  }, [api]);

  useEffect(() => {
    if (!profId) return;
    setLoading(true);
    api
      .get<Slot[]>(`/api/scheduling/client/slots?professionalId=${profId}&from=${from}&days=7`)
      .then(setSlots)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [api, profId, from]);

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) m.set(s.start_at.slice(0, 10), [...(m.get(s.start_at.slice(0, 10)) ?? []), s]);
    return [...m];
  }, [slots]);

  async function book() {
    if (!choice || !profId) return;
    setError(null);
    try {
      await api.post('/api/scheduling/client/appointments', { professionalId: profId, start: choice.start_at.slice(0, 16), reason });
      setChoice(null);
      onBooked();
    } catch (e) {
      setError(errMsg(e));
      setChoice(null);
    }
  }

  if (profs && !profs.length) return <EmptyState icon="🔒" title="Aún no tienes profesionales" description="Un profesional debe compartirte acceso para que puedas agendar." />;
  return (
    <div>
      {error && <Notice tone="error">{error}</Notice>}
      {profs && profs.length > 1 && (
        <div className="mb-4">
          <Label>Profesional</Label>
          <Select value={profId} onChange={(e) => setProfId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Elige…</option>
            {profs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.specialty ? ` · ${p.specialty}` : ''}
              </option>
            ))}
          </Select>
        </div>
      )}
      {profId !== '' && (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="secondary" disabled={from <= todayISO()} onClick={() => setFrom(addDaysISO(from, -7))}>
              ← Anteriores
            </Button>
            <p className="text-sm text-gray-dark">
              {formatDayLong(from)} – {formatDayLong(addDaysISO(from, 6))}
            </p>
            <Button variant="secondary" onClick={() => setFrom(addDaysISO(from, 7))}>
              Siguientes →
            </Button>
          </div>
          {loading && <p className="text-sm text-gray-dark">Buscando espacios…</p>}
          {!loading && !byDay.length && <EmptyState icon="🗓️" title="No hay espacios disponibles esos días" description="Prueba la semana siguiente." />}
          <div className="space-y-3">
            {byDay.map(([day, list]) => (
              <Card key={day} className="p-4">
                <p className="mb-2 font-medium capitalize text-ink dark:text-white">{formatDayLong(day)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((s) => (
                    <button key={s.start_at} onClick={() => setChoice(s)} className="rounded-lg border border-gray-medium px-3 py-1.5 text-sm hover:border-primary hover:bg-primary/5 dark:border-white/10">
                      {time12(s.start_at)}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      {choice && (
        <Modal title="Confirmar solicitud" onClose={() => setChoice(null)}>
          <p className="mb-3 text-sm capitalize text-ink dark:text-white">{formatWhen(choice.start_at)}</p>
          <Label>Motivo (opcional)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. primera consulta" />
          <p className="mt-2 text-xs text-gray-dark">Queda pendiente hasta que el profesional la confirme. Te aviso por WhatsApp.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setChoice(null)}>
              Cancelar
            </Button>
            <Button onClick={book}>Pedir cita</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
