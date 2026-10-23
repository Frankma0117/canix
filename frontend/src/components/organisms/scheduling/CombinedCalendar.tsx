import { useCallback, useEffect, useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Appointment, SchedGroup } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Select } from '../../atoms/Input.tsx';
import { Calendar, Legend, calendarRange, type CalendarView } from './AppointmentCalendar.tsx';
import { AppointmentDetail } from './AppointmentDetail.tsx';
import { addDaysISO, addMonthsISO, todayISO } from '../../../utils/dates.ts';
import { ProRow } from '../../../types/scheduling-admin.ts';

export function CombinedCalendar() {
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
