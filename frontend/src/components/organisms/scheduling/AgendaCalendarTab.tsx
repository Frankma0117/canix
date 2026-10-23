import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Appointment, TimeOff } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Select } from '../../atoms/Input.tsx';
import { Calendar, Legend, calendarRange, type CalendarView } from './AppointmentCalendar.tsx';
import { AppointmentDetail } from './AppointmentDetail.tsx';
import { addDaysISO, addMonthsISO, todayISO } from '../../../utils/dates.ts';
import { NewAppointment } from './NewAppointment.tsx';

// ------------------------------------------------------------------ calendar
export function AgendaCalendarTab({ timeOff, onChanged }: { timeOff: TimeOff[]; onChanged: () => void }) {
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
