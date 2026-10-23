import { useCallback, useEffect, useState } from 'react';
import { useApi, errMsg } from '../../services/api.ts';
import type { Appointment } from '../../types/index.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { AppointmentDetail } from '../../components/organisms/scheduling/AppointmentDetail.tsx';
import { nowWall } from '../../utils/dates.ts';
import { AppointmentRow } from '../../components/molecules/scheduling/AppointmentRow.tsx';
import { BookAppointment } from '../../components/organisms/scheduling/BookAppointment.tsx';

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
