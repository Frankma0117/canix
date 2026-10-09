import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { MealPlan, MealSlot } from '../lib/types.ts';
import { Page, Notice } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Select, Textarea } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { addDaysISO, todayISO, formatDayLong } from '../lib/dates.ts';
import { useCreated } from '../components/ui/Created.tsx';

const SLOTS: { id: MealSlot; label: string; emoji: string }[] = [
  { id: 'desayuno', label: 'Desayuno', emoji: '🍳' },
  { id: 'almuerzo', label: 'Almuerzo', emoji: '🍲' },
  { id: 'onces', label: 'Onces', emoji: '☕' },
  { id: 'cena', label: 'Cena', emoji: '🍽️' },
];

export function MealsPage() {
  const api = useApi();
  const created = useCreated();
  const [from, setFrom] = useState(todayISO());
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [draft, setDraft] = useState<{ plan_date: string; meal_slot: MealSlot; title: string; notes: string } | null>(null);
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
      await api.post('/api/meals', draft);
      created({ kind: 'Comida planeada', title: draft.title.trim(), section: 'meals', details: [draft.plan_date], sticker: 'listo' });
      setDraft(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title="Plan de comidas"
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
                    <button className="rounded p-0.5 hover:text-primary" onClick={() => setDraft({ plan_date: d, meal_slot: s.id, title: '', notes: '' })} aria-label="Agregar">
                      <Plus size={14} />
                    </button>
                  </div>
                  {items.map((p) => (
                    <div key={p.id} className="group flex items-start justify-between gap-2 pl-5 text-sm text-ink dark:text-white/90">
                      <span>
                        {p.title}
                        {p.notes && <span className="block text-xs text-gray-dark">{p.notes}</span>}
                      </span>
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
        <Modal title="Agregar comida" onClose={() => setDraft(null)}>
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
