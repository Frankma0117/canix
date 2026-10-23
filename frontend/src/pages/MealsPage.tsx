import { useEffect, useMemo, useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { MealPlan, MealSlot } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Card } from '../components/atoms/Card.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Input, Label, Select, Textarea, Hint } from '../components/atoms/Input.tsx';
import { Modal } from '../components/organisms/Modal.tsx';
import { addDaysISO, todayISO, formatDayLong, time12 } from '../utils/dates.ts';

const SLOTS: { id: MealSlot; label: string; emoji: string }[] = [
  { id: 'desayuno', label: 'Desayuno', emoji: '🍳' },
  { id: 'onces', label: 'Onces', emoji: '🍎' },
  { id: 'almuerzo', label: 'Almuerzo', emoji: '🍲' },
  { id: 'media_tarde', label: 'Media tarde', emoji: '☕' },
  { id: 'cena', label: 'Cena', emoji: '🍽️' },
];

/** Usual hour of each meal - the default when turning the notice on. */
const USUAL_TIME: Record<MealSlot, string> = { desayuno: '07:00', onces: '10:00', almuerzo: '12:30', media_tarde: '16:00', cena: '19:30' };

interface MealDraft {
  id?: number;
  plan_date: string;
  meal_slot: MealSlot;
  title: string;
  notes: string;
  meal_time: string;
  prep_minutes: string;
}

const draftOf = (p: MealPlan): MealDraft => ({
  id: p.id,
  plan_date: p.plan_date,
  meal_slot: p.meal_slot,
  title: p.title,
  notes: p.notes ?? '',
  meal_time: p.meal_time ?? '',
  prep_minutes: p.prep_minutes ? String(p.prep_minutes) : '',
});

export function MealsPage() {
  const api = useApi();
  const [from, setFrom] = useState(todayISO());
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(from, i)), [from]);

  const load = () =>
    api
      .get<MealPlan[]>(`/api/meals?from=${from}&to=${addDaysISO(from, 6)}`)
      .then(setPlans)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  async function save() {
    if (!draft?.title.trim()) return;
    try {
      const { id, ...fields } = draft;
      const body = { ...fields, meal_time: fields.meal_time || null, prep_minutes: fields.meal_time && Number(fields.prep_minutes) > 0 ? Number(fields.prep_minutes) : null };
      if (id) await api.put(`/api/meals/${id}`, body);
      else await api.post('/api/meals', body);
      setDraft(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title="Plan de comidas"
      description="Ponle hora a una comida y Canix te avisa por WhatsApp «hora del almuerzo» - y, si quieres, antes «toca preparar». Lo mismo le puedes pedir en el chat."
      wide
      actions={
        <>
          <Button variant="secondary" onClick={() => setFrom(addDaysISO(from, -7))}>
            ← Semana anterior
          </Button>
          <Button variant="secondary" onClick={() => setFrom(todayISO())}>
            Hoy
          </Button>
          <Button variant="secondary" onClick={() => setFrom(addDaysISO(from, 7))}>
            Siguiente →
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {days.map((d) => (
          <Card key={d} className="p-4">
            <p className="mb-2 font-display font-semibold capitalize text-ink dark:text-white">{formatDayLong(d)}</p>
            {SLOTS.map((s) => {
              const items = plans.filter((p) => p.plan_date === d && p.meal_slot === s.id);
              return (
                <div key={s.id} className="mb-2">
                  <div className="flex items-center justify-between text-xs font-medium text-gray-dark">
                    <span>
                      {s.emoji} {s.label}
                    </span>
                    <button className="rounded p-0.5 hover:text-primary" onClick={() => setDraft({ plan_date: d, meal_slot: s.id, title: '', notes: '', meal_time: '', prep_minutes: '' })} aria-label="Agregar">
                      <Plus size={14} />
                    </button>
                  </div>
                  {items.map((p) => (
                    <div key={p.id} className="group flex items-start justify-between gap-2 pl-5 text-sm text-ink dark:text-white/90">
                      <button className="text-left hover:text-primary" onClick={() => setDraft(draftOf(p))}>
                        {p.title}
                        {p.meal_time && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-primary">
                            <Bell size={11} /> {time12(`${p.plan_date} ${p.meal_time}:00`)}
                          </span>
                        )}
                        {p.notes && <span className="block text-xs text-gray-dark">{p.notes}</span>}
                        {p.meal_time && p.prep_minutes && <span className="block text-xs text-gray-dark">👩‍🍳 aviso para preparar {p.prep_minutes} min antes</span>}
                      </button>
                      <button
                        className="hidden text-gray-dark hover:text-error group-hover:block"
                        onClick={() => api.del(`/api/meals/${p.id}`).then(load).catch((e) => setError(errMsg(e)))}
                        aria-label="Quitar"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </Card>
        ))}
      </div>

      {draft && (
        <Modal title={draft.id ? 'Editar comida' : 'Agregar comida'} onClose={() => setDraft(null)}>
          <Label>Comida</Label>
          <Select value={draft.meal_slot} onChange={(e) => setDraft({ ...draft, meal_slot: e.target.value as MealSlot })}>
            {SLOTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <div className="h-3" />
          <Label>Plato</Label>
          <Input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div className="h-3" />
          <Label>Notas (opcional)</Label>
          <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="h-3" />
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink dark:text-white/85">
            <input
              type="checkbox"
              checked={!!draft.meal_time}
              onChange={(e) => setDraft({ ...draft, meal_time: e.target.checked ? USUAL_TIME[draft.meal_slot] : '', prep_minutes: e.target.checked ? draft.prep_minutes : '' })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Avisarme a la hora
          </label>
          {draft.meal_time && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Hora</Label>
                <Input type="time" value={draft.meal_time} onChange={(e) => setDraft({ ...draft, meal_time: e.target.value })} />
              </div>
              <div>
                <Label>Aviso para preparar (min antes)</Label>
                <Input inputMode="numeric" placeholder="30" value={draft.prep_minutes} onChange={(e) => setDraft({ ...draft, prep_minutes: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
              </div>
            </div>
          )}
          <Hint>Sin hora es solo planeación: no te llega ningún aviso.</Hint>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!draft.title.trim()}>
              Guardar
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
