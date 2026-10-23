import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { AvailabilityRule, TimeOff } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label } from '../../atoms/Input.tsx';
import { WEEKDAY_NAMES } from '../../../utils/dates.ts';

// ------------------------------------------------------------------ schedule
export function AgendaScheduleTab({ rules, timeOff, onSaved }: { rules: AvailabilityRule[]; timeOff: TimeOff[]; onSaved: () => void }) {
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
