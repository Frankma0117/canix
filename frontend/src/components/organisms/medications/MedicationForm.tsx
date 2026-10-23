import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Medication, MedicationKind, MedicationsResponse } from '../../../types/index.ts';
import { Modal } from '../Modal.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select, Textarea, Hint } from '../../atoms/Input.tsx';
import { WEEKDAY_SHORT, todayISO, addDaysISO } from '../../../utils/dates.ts';

export interface MedicationDraft {
  id?: number;
  name: string;
  kind: MedicationKind;
  dose: string;
  instructions: string;
  times: string[];
  /** Empty = every day. */
  weekdays: number[];
  start_date: string;
  end_date: string;
  notes: string;
}

/** Water preset: a glass every 2 hours from 8 am to 8 pm. */
export function waterDraft(): MedicationDraft {
  return { ...medicationDraftOf(null), name: 'Agua', kind: 'water', dose: '1 vaso', times: timesEvery(2, '08:00', '20:00') };
}

export function medicationDraftOf(med: Medication | null): MedicationDraft {
  return {
    id: med?.id,
    name: med?.name ?? '',
    kind: med?.kind ?? 'medicine',
    dose: med?.dose ?? '',
    instructions: med?.instructions ?? '',
    times: med?.times.length ? med.times : ['08:00'],
    weekdays: med?.weekdays ?? [],
    start_date: med?.start_date ?? todayISO(),
    end_date: med?.end_date ?? '',
    notes: med?.notes ?? '',
  };
}

/** Every `hours` from `first` until `until` (or the end of the day): 2 h from 08:00 to 20:00 -> 08:00, 10:00 … 20:00. */
function timesEvery(hours: number, first: string, until = '23:59'): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let at = toMinutes(first); at <= toMinutes(until); at += Math.round(hours * 60)) {
    out.push(`${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`);
  }
  return out;
}

/** Create or edit a medication / vitamin / cream: its notice times, days, dose and treatment length. */
export function MedicationForm({
  initial,
  kinds,
  onCancel,
  onSave,
}: {
  initial: MedicationDraft;
  kinds: MedicationsResponse['kinds'];
  onCancel: () => void;
  onSave: (draft: MedicationDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [every, setEvery] = useState(initial.kind === 'water' ? '2' : '');
  const [until, setUntil] = useState(initial.kind === 'water' ? '20:00' : '');
  const water = draft.kind === 'water';
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof MedicationDraft>(key: K, value: MedicationDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setTime = (i: number, value: string) => set('times', draft.times.map((t, j) => (j === i ? value : t)));
  const toggleDay = (d: number) => set('weekdays', draft.weekdays.includes(d) ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d].sort());
  const valid = draft.name.trim() && draft.times.some((t) => /^\d{2}:\d{2}$/.test(t));

  async function submit() {
    setSaving(true);
    try {
      await onSave({ ...draft, times: [...new Set(draft.times.filter(Boolean))].sort() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={draft.id ? `Editar ${draft.name || 'medicamento'}` : water ? 'Recordatorio de agua' : 'Agregar a Medicamentos y belleza'} onClose={onCancel} size="md">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Tipo</Label>
          <Select
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as MedicationKind;
              // picking "Agua" on a blank form fills the usual: a glass every 2 h, 8 am to 8 pm
              if (kind === 'water' && !draft.name.trim()) {
                setDraft({ ...waterDraft(), id: draft.id });
                setEvery('2');
                setUntil('20:00');
              } else set('kind', kind);
            }}
          >
            {Object.entries(kinds).map(([id, k]) => (
              <option key={id} value={id}>
                {k.emoji} {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Nombre</Label>
          <Input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={water ? 'Agua' : draft.kind === 'bodycare' ? 'Ponerme la faja, Quitarme la faja…' : 'Vitamina D, Losartán, crema de noche…'} />
          {draft.kind === 'bodycare' && <Hint>Escríbelo como la acción: el aviso dirá «Toca ponerte la faja». Ponértela y quitártela van como dos, cada una con su hora.</Hint>}
        </div>
        <div>
          <Label>{water ? 'Cantidad por aviso' : 'Dosis'}</Label>
          <Input value={draft.dose} onChange={(e) => set('dose', e.target.value)} placeholder={water ? '1 vaso (250 ml)' : '1 tableta, 500 mg, 2 gotas'} />
        </div>
        <div>
          <Label>Indicaciones</Label>
          <Input value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="con el desayuno, en ayunas" />
        </div>
      </div>

      <div className="mt-4">
        <Label>Horas del aviso</Label>
        <div className="flex flex-wrap items-center gap-2">
          {draft.times.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <Input type="time" value={t} onChange={(e) => setTime(i, e.target.value)} className="w-32" />
              {draft.times.length > 1 && (
                <button type="button" className="text-gray-dark hover:text-error" onClick={() => set('times', draft.times.filter((_, j) => j !== i))} aria-label="Quitar hora">
                  <X size={14} />
                </button>
              )}
            </span>
          ))}
          <Button variant="soft" size="sm" onClick={() => set('times', [...draft.times, '20:00'])}>
            <Plus size={14} /> Hora
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-dark">
          o cada
          <Input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, '').slice(0, 2))} className="w-16" placeholder="8" />
          horas desde la primera hasta las
          <Input type="time" value={until} onChange={(e) => setUntil(e.target.value)} className="w-32" />
          <Button variant="secondary" size="sm" disabled={!(Number(every) > 0)} onClick={() => set('times', timesEvery(Number(every), draft.times[0] || '08:00', until || undefined))}>
            Calcular
          </Button>
        </div>
        <Hint>
          {water
            ? `Meta: ${draft.times.filter(Boolean).length} vasos al día. A cada hora Canix te escribe «💧 hora de tomar agua»; cada 👍 suma un vaso.`
            : 'A cada hora Canix te escribe «toca tomar…» por WhatsApp y lo confirmas con 👍 o 👎.'}
        </Hint>
      </div>

      <div className="mt-4">
        <Label>Días</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_SHORT.map((name, d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition ${
                draft.weekdays.includes(d) ? 'bg-primary text-white ring-primary' : 'bg-white text-gray-dark ring-gray-medium hover:ring-primary/50 dark:bg-white/5 dark:ring-white/10'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <Hint>{draft.weekdays.length === 0 ? 'Sin elegir = todos los días.' : 'Solo esos días.'}</Hint>
      </div>

      <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${water ? 'hidden' : ''}`}>
        <div>
          <Label>Desde</Label>
          <Input type="date" value={draft.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </div>
        <div>
          <Label>Hasta (tratamiento)</Label>
          <Input type="date" value={draft.end_date} min={draft.start_date} onChange={(e) => set('end_date', e.target.value)} />
          <div className="mt-1 flex gap-1.5">
            {[7, 10, 14, 30].map((n) => (
              <button key={n} type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => set('end_date', addDaysISO(draft.start_date || todayISO(), n - 1))}>
                {n} días
              </button>
            ))}
            {draft.end_date && (
              <button type="button" className="text-xs font-semibold text-gray-dark hover:underline" onClick={() => set('end_date', '')}>
                sin fin
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Label>Notas</Label>
        <Textarea rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Quién lo recetó, para qué es…" />
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={saving} disabled={!valid}>
          Guardar
        </Button>
      </div>
    </Modal>
  );
}
