import { useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Category, Routine } from '../../../types/index.ts';
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from '../../../utils/dates.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select, Hint } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';
import { Draft, Mode, WEEK_ORDER, clockText, joinDays, modeOf, scheduleOfDraft } from '../../../utils/routines.ts';

export const MODES: { id: Mode; title: string; hint: string }[] = [
  { id: 'daily', title: 'Todos los días', hint: 'De lunes a domingo' },
  { id: 'weekly', title: 'Ciertos días de la semana', hint: 'Ej. lunes, miércoles y viernes' },
  { id: 'spaced', title: 'Cada 15 días', hint: 'O cada 3, 4… semanas' },
  { id: 'monthly', title: 'Cada mes', hint: 'Un día fijo del mes' },
  { id: 'everyN', title: 'Cada ciertos días', hint: 'Ej. un día sí y dos no' },
];

export function summaryOf(d: Draft): string {
  const s = scheduleOfDraft(d);
  const at = d.time ? ` a las ${clockText(d.time)}` : '';
  if (d.mode === 'daily') return `Canix te avisa todos los días${at}.`;
  if (d.mode === 'weekly') return d.weekdays.length ? `Canix te avisa cada ${joinDays(d.weekdays)}${at}.` : 'Elige al menos un día.';
  if (d.mode === 'spaced') {
    if (!d.weekdays.length) return 'Elige al menos un día.';
    const every = s.recurrence_interval === 2 ? 'cada 15 días' : `cada ${s.recurrence_interval} semanas`;
    return `Canix te avisa ${every}, los ${joinDays(d.weekdays)}${at}.`;
  }
  if (d.mode === 'monthly') {
    const every = s.recurrence_interval === 1 ? 'cada mes' : `cada ${s.recurrence_interval} meses`;
    return `Canix te avisa ${every}, el día ${d.monthDay || '…'}${at}. En meses más cortos, el último día.`;
  }
  return `Canix te avisa cada ${s.recurrence_interval} días${at}.`;
}

export function RoutineForm({
  initial,
  original,
  categories,
  onClose,
  onSaved,
}: {
  initial: Draft;
  original: Routine | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useApi();
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  const needsDays = d.mode === 'weekly' || d.mode === 'spaced';
  const monthDayOk = d.mode !== 'monthly' || (Number(d.monthDay) >= 1 && Number(d.monthDay) <= 31);
  const valid = d.title.trim() && d.time && Number(d.duration) > 0 && (!needsDays || d.weekdays.length > 0) && monthDayOk;

  function toggleDay(day: number) {
    set({ weekdays: d.weekdays.includes(day) ? d.weekdays.filter((x) => x !== day) : [...d.weekdays, day] });
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    const schedule = scheduleOfDraft(d);
    const basics = { title: d.title.trim(), category_id: d.categoryId ? Number(d.categoryId) : null, duration_minutes: Number(d.duration) };
    try {
      if (!original) {
        await api.post('/api/todos', { scope: 'routine', ...basics, reminder_time: d.time, ...schedule });
      } else {
        // The days/frequency are only sent when they really changed: re-sending them makes the
        // server re-anchor the routine, which could move an every-two-weeks one to the other week.
        const sameSchedule =
          modeOf(original) === d.mode &&
          schedule.recurrence_interval === original.interval &&
          (!needsDays || schedule.weekdays.join() === original.weekdays.join()) &&
          (d.mode !== 'monthly' || schedule.month_day === original.month_day);
        await api.put(`/api/todos/${original.id}`, {
          ...basics,
          ...(d.time !== original.reminder_time ? { reminder_time: d.time } : {}),
          ...(sameSchedule ? {} : schedule),
        });
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={original ? 'Editar rutina' : 'Nueva rutina'} onClose={onClose} size="md">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="space-y-5">
        <div>
          <Label htmlFor="routine-title">¿Qué rutina es?</Label>
          <Input id="routine-title" value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus placeholder="Ej. Ejercicio, leer, tomar la pastilla" />
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold text-ink dark:text-white/85">¿Cada cuánto?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((m) => {
              const on = d.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ mode: m.id })}
                  className={`rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${
                    on ? 'border-primary bg-primary/5 ring-1 ring-primary dark:bg-primary/15' : 'border-gray-medium hover:border-primary/40 dark:border-white/10'
                  }`}
                >
                  <span className="block text-sm font-semibold text-ink dark:text-white">{m.title}</span>
                  <span className="block text-xs text-gray-dark">{m.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {needsDays && (
          <fieldset>
            <legend className="mb-1.5 block text-sm font-semibold text-ink dark:text-white/85">¿Qué días?</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK_ORDER.map((day) => {
                const on = d.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={WEEKDAY_NAMES[day]}
                    onClick={() => toggleDay(day)}
                    className={`h-11 min-w-[3.25rem] rounded-xl border px-3 text-sm font-semibold capitalize transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${
                      on ? 'border-primary bg-primary text-white' : 'border-gray-medium text-ink hover:border-primary/40 dark:border-white/10 dark:text-white'
                    }`}
                  >
                    {WEEKDAY_SHORT[day]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {d.mode === 'spaced' && (
          <div>
            <Label htmlFor="routine-weeks">¿Cada cuántas semanas?</Label>
            <Input id="routine-weeks" type="number" min={2} max={52} value={d.interval} onChange={(e) => set({ interval: e.target.value })} className="max-w-[8rem]" />
            <Hint>2 = cada 15 días. Empieza en su próximo día y de ahí cuenta.</Hint>
          </div>
        )}
        {d.mode === 'everyN' && (
          <div>
            <Label htmlFor="routine-days">¿Cada cuántos días?</Label>
            <Input id="routine-days" type="number" min={2} max={52} value={d.interval} onChange={(e) => set({ interval: e.target.value })} className="max-w-[8rem]" />
          </div>
        )}
        {d.mode === 'monthly' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="routine-monthday">¿Qué día del mes?</Label>
              <Input id="routine-monthday" type="number" min={1} max={31} value={d.monthDay} onChange={(e) => set({ monthDay: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="routine-months">¿Cada cuántos meses?</Label>
              <Input id="routine-months" type="number" min={1} max={12} value={d.monthEvery} onChange={(e) => set({ monthEvery: e.target.value })} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="routine-time">Hora del aviso</Label>
            <Input id="routine-time" type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="routine-duration">Duración (minutos)</Label>
            <Input id="routine-duration" type="number" min={1} value={d.duration} onChange={(e) => set({ duration: e.target.value })} />
          </div>
        </div>

        <div>
          <Label htmlFor="routine-cat">Categoría (opcional)</Label>
          <Select id="routine-cat" value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <p className="rounded-xl bg-secondary px-3.5 py-3 text-sm text-primary-dark dark:bg-primary/15 dark:text-white" aria-live="polite">
          {summaryOf(d)} El aviso llega con una encuesta de <strong>Sí / No</strong> para marcarla con un toque cuando termines.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!valid}>
            {original ? 'Guardar cambios' : 'Crear rutina'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
