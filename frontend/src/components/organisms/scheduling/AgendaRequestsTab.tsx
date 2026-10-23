import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Appointment } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { AppointmentDetail } from './AppointmentDetail.tsx';
import { formatWhen } from '../../../utils/dates.ts';

// ------------------------------------------------------------------ requests
export function AgendaRequestsTab({ pending, onChanged }: { pending: Appointment[]; onChanged: () => void }) {
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
