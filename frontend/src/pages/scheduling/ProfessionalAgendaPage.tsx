import { useCallback, useEffect, useState } from 'react';
import { useApi, errMsg } from '../../services/api.ts';
import type { Appointment, AvailabilityRule, ProfessionalProfile, TimeOff } from '../../types/index.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { addDaysISO, todayISO } from '../../utils/dates.ts';
import { AgendaCalendarTab } from '../../components/organisms/scheduling/AgendaCalendarTab.tsx';
import { AgendaClientsTab } from '../../components/organisms/scheduling/AgendaClientsTab.tsx';
import { AgendaRequestsTab } from '../../components/organisms/scheduling/AgendaRequestsTab.tsx';
import { AgendaScheduleTab } from '../../components/organisms/scheduling/AgendaScheduleTab.tsx';
import { AgendaSettingsTab } from '../../components/organisms/scheduling/AgendaSettingsTab.tsx';

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
      {tab === 'calendar' && <AgendaCalendarTab timeOff={timeOff} onChanged={loadPending} />}
      {tab === 'requests' && <AgendaRequestsTab pending={pending} onChanged={loadPending} />}
      {tab === 'schedule' && <AgendaScheduleTab rules={rules} timeOff={timeOff} onSaved={loadProfile} />}
      {tab === 'clients' && <AgendaClientsTab />}
      {tab === 'settings' && profile && <AgendaSettingsTab profile={profile} onSaved={loadProfile} />}
    </Page>
  );
}
