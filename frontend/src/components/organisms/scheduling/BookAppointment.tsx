import { useEffect, useMemo, useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Slot } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { addDaysISO, formatDayLong, formatWhen, time12, todayISO } from '../../../utils/dates.ts';

export interface Prof {
  id: number;
  name: string;
  specialty: string | null;
  slot_minutes: number;
}

export function BookAppointment({ onBooked }: { onBooked: () => void }) {
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
