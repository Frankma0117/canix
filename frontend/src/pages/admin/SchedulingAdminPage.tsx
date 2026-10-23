import { useState } from 'react';
import { Page } from '../../components/templates/Page.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { CombinedCalendar } from '../../components/organisms/scheduling/CombinedCalendar.tsx';
import { SchedulingGroups } from '../../components/organisms/scheduling/SchedulingGroups.tsx';

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
      {tab === 'calendar' ? <CombinedCalendar /> : <SchedulingGroups />}
    </Page>
  );
}
