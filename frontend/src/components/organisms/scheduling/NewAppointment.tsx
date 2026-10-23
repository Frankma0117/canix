import { useEffect, useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { SchedClient, Slot } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';
import { todayISO, time12, formatDayLong } from '../../../utils/dates.ts';

export function NewAppointment({ date: initial, onClose, onCreated }: { date: string; onClose: () => void; onCreated: () => void }) {
  const api = useApi();
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
