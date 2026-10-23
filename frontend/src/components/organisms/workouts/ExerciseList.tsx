import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Exercise } from '../../../types/index.ts';
import { Button, IconButton } from '../../atoms/Button.tsx';
import { Input } from '../../atoms/Input.tsx';

/** "3 × 12 · 20 kg", "3 × 180 s", "15 rep" - same as the WhatsApp notice. */
export function exerciseDose(e: Pick<Exercise, 'sets' | 'reps' | 'seconds' | 'weight_kg'>): string {
  const amount = e.reps ? `${e.reps}${e.sets ? '' : ' rep'}` : e.seconds ? `${e.seconds} s` : '';
  const sets = e.sets && amount ? `${e.sets} × ${amount}` : e.sets ? `${e.sets} series` : amount;
  return [sets, e.weight_kg ? `${e.weight_kg} kg` : ''].filter(Boolean).join(' · ');
}

interface Row {
  name: string;
  sets: string;
  reps: string;
  seconds: string;
  weight_kg: string;
}

const EMPTY: Row = { name: '', sets: '', reps: '', seconds: '', weight_kg: '' };
const rowOf = (e: Exercise): Row => ({ name: e.name, sets: e.sets ? String(e.sets) : '', reps: e.reps ? String(e.reps) : '', seconds: e.seconds ? String(e.seconds) : '', weight_kg: e.weight_kg ? String(e.weight_kg) : '' });
const bodyOf = (r: Row) => ({ name: r.name.trim(), sets: r.sets || null, reps: r.reps || null, seconds: r.seconds || null, weight_kg: r.weight_kg || null });

/**
 * The exercises of a workout, in order (rounds of shadow boxing, squats 4 × 12...): added, edited and
 * removed right here. Canix sends them inside the notice of each session so they can be followed.
 */
export function ExerciseList({ workoutId, exercises, onChanged, onError }: { workoutId: number; exercises: Exercise[]; onChanged: () => Promise<void>; onError: (msg: string) => void }) {
  const api = useApi();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [row, setRow] = useState<Row>(EMPTY);
  const [busy, setBusy] = useState(false);

  async function run(action: Promise<unknown>) {
    setBusy(true);
    try {
      await action;
      setEditing(null);
      setRow(EMPTY);
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(editing === 'new' ? api.post(`/api/workouts/${workoutId}/exercises`, bodyOf(row)) : api.patch(`/api/workouts/${workoutId}/exercises/${editing}`, bodyOf(row)));
  const num = (key: keyof Row, value: string) => setRow((r) => ({ ...r, [key]: value.replace(/[^\d.]/g, '').slice(0, 5) }));

  const editor = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/60 p-2 dark:bg-white/5">
      <Input autoFocus value={row.name} onChange={(e) => setRow((r) => ({ ...r, name: e.target.value }))} placeholder="Sombra, sentadillas, saltar lazo…" className="min-w-[10rem] flex-1" />
      <Input inputMode="numeric" value={row.sets} onChange={(e) => num('sets', e.target.value)} placeholder="Series" className="w-20" aria-label="Series o rounds" />
      <Input inputMode="numeric" value={row.reps} onChange={(e) => num('reps', e.target.value)} placeholder="Rep." className="w-20" aria-label="Repeticiones" />
      <Input inputMode="numeric" value={row.seconds} onChange={(e) => num('seconds', e.target.value)} placeholder="Seg." className="w-20" aria-label="Segundos" />
      <Input inputMode="decimal" value={row.weight_kg} onChange={(e) => num('weight_kg', e.target.value)} placeholder="Kg" className="w-20" aria-label="Peso en kg" />
      <IconButton label="Guardar" onClick={save} disabled={!row.name.trim() || busy}>
        <Check size={16} />
      </IconButton>
      <IconButton label="Cancelar" onClick={() => setEditing(null)}>
        <X size={16} />
      </IconButton>
    </div>
  );

  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-dark">Ejercicios {exercises.length > 0 && `· ${exercises.length}`}</p>
      {exercises.length === 0 && editing !== 'new' && <p className="mb-2 text-sm text-gray-dark">Agrega lo que haces en cada sesión (rounds, series, tiempos) y Canix te lo manda en el aviso.</p>}
      <ol className="space-y-1.5">
        {exercises.map((e, i) =>
          editing === e.id ? (
            <li key={e.id}>{editor}</li>
          ) : (
            <li key={e.id} className="group flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
              <span className="font-semibold text-ink dark:text-white">{e.name}</span>
              {exerciseDose(e) && <span className="text-gray-dark">— {exerciseDose(e)}</span>}
              <span className="flex-1" />
              <span className="flex opacity-60 transition group-hover:opacity-100">
                <IconButton
                  label={`Editar ${e.name}`}
                  onClick={() => {
                    setRow(rowOf(e));
                    setEditing(e.id);
                  }}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton label={`Quitar ${e.name}`} onClick={() => void run(api.del(`/api/workouts/${workoutId}/exercises/${e.id}`))}>
                  <Trash2 size={14} />
                </IconButton>
              </span>
            </li>
          ),
        )}
      </ol>
      {editing === 'new' ? (
        <div className="mt-2">{editor}</div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => {
            setRow(EMPTY);
            setEditing('new');
          }}
        >
          <Plus size={14} /> Agregar ejercicio
        </Button>
      )}
    </div>
  );
}
