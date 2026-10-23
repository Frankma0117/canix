import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { Medication, MedicationKind, MedicationsResponse } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { useToast } from '../components/molecules/Toast.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { MedicationCard } from '../components/organisms/medications/MedicationCard.tsx';
import { MedicationForm, medicationDraftOf, waterDraft, type MedicationDraft } from '../components/organisms/medications/MedicationForm.tsx';
import { time12 } from '../utils/dates.ts';

type KindTab = MedicationKind | 'all';

/**
 * Medicamentos y belleza: pills, vitamins, creams and skincare with their times. The same things
 * Canix handles on WhatsApp ("la vitamina D a las 8am", "qué medicamentos tengo") - at each time it
 * sends "toca tomar…" and the answer (👍/👎 or "Tomada hoy" here) shows in the weekly count.
 */
export function MedicationsPage() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<MedicationsResponse | null>(null);
  const [tab, setTab] = useState<KindTab>('all');
  const [editing, setEditing] = useState<MedicationDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<MedicationsResponse>('/api/medications'));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const items = useMemo(() => (data?.items ?? []).filter((m) => tab === 'all' || m.kind === tab), [data, tab]);
  // Today's doses in order, for the "Hoy" strip.
  const today = useMemo(
    () =>
      (data?.items ?? [])
        .filter((m) => m.active && m.kind !== 'water') // water has its own panel
        .flatMap((m) => m.times.map((t) => ({ time: t, med: m })))
        .sort((a, b) => a.time.localeCompare(b.time)),
    [data],
  );

  async function run(action: Promise<unknown>, message: string) {
    try {
      await action;
      toast.success(message);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function save(draft: MedicationDraft) {
    const body = {
      name: draft.name,
      kind: draft.kind,
      dose: draft.dose,
      instructions: draft.instructions,
      times: draft.times,
      weekdays: draft.weekdays,
      start_date: draft.start_date || null,
      end_date: draft.end_date || null,
      notes: draft.notes,
    };
    try {
      if (draft.id) await api.patch(`/api/medications/${draft.id}`, body);
      else await api.post('/api/medications', body);
      setEditing(null);
      toast.success(draft.id ? 'Guardado. Los avisos quedaron con las horas nuevas.' : 'Listo, Canix te avisará a cada hora.');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const remove = (med: Medication) => {
    if (!confirm(`¿Borrar "${med.name}" con sus avisos e historial? Si solo lo dejas un tiempo, mejor páusalo.`)) return;
    void run(api.del(`/api/medications/${med.id}`), 'Borrado.');
  };

  const kinds = data?.kinds;
  const water = (data?.items ?? []).find((m) => m.kind === 'water' && m.active);
  const hasWater = (data?.items ?? []).some((m) => m.kind === 'water');
  const counts = (k: KindTab) => (data?.items ?? []).filter((m) => k === 'all' || m.kind === k).length;

  return (
    <Page
      title="Medicamentos y belleza"
      eyebrow="Hábitos"
      sticker="agendado"
      description="Medicamentos, vitaminas, suplementos, cremas, skincare, tomar agua y cuidado corporal como la faja. A cada hora Canix te escribe por WhatsApp; confírmalo con 👍/👎 o aquí."
      wide
      actions={
        <>
          <Button onClick={() => setEditing(medicationDraftOf(null))} disabled={!kinds}>
            <Plus size={16} /> Agregar
          </Button>
          {!hasWater && (
            <Button variant="secondary" onClick={() => setEditing(waterDraft())} disabled={!kinds}>
              💧 Recordarme tomar agua
            </Button>
          )}
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!data || !kinds ? (
        <Skeleton className="h-64" />
      ) : data.items.length === 0 ? (
        <EmptyState
          sticker="agendado"
          title="Nada por aquí todavía"
          description='Agrégalo aquí o dile a Canix por WhatsApp: "la vitamina D todos los días a las 8am", "el antibiótico cada 8 horas por 7 días" o "recuérdame tomar agua cada 2 horas".'
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setEditing(medicationDraftOf(null))}>Agregar el primero</Button>
              <Button variant="secondary" onClick={() => setEditing(waterDraft())}>
                💧 Recordarme tomar agua
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {water && (
            <div className="mb-5 flex flex-wrap items-center gap-4 rounded-3xl border border-sky-300/50 bg-sky-500/10 px-5 py-4 dark:border-sky-400/20">
              <span className="text-4xl">💧</span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-bold text-ink dark:text-white">
                  Hoy llevas {water.today.done} de {water.today.goal} vasos
                </p>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                  <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${water.today.goal ? Math.min(100, (water.today.done / water.today.goal) * 100) : 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-gray-dark">Avisos a las {water.times.map((t) => time12(`2000-01-01 ${t}:00`)).join(', ')}</p>
              </div>
              <Button onClick={() => void run(api.post(`/api/medications/${water.id}/log`, { taken: true }), '💧 ¡Un vaso más!')}>+1 vaso</Button>
            </div>
          )}
          {today.length > 0 && (
            <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
              {today.map(({ time, med }) => (
                <div key={`${med.id}-${time}`} className="shrink-0 rounded-2xl border border-gray-medium/60 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs font-bold text-primary">{time12(`2000-01-01 ${time}:00`)}</p>
                  <p className="font-semibold text-ink dark:text-white">
                    {kinds[med.kind]?.emoji} {med.name}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Tabs
            tabs={[{ id: 'all' as KindTab, label: 'Todo', count: counts('all') }, ...(Object.keys(kinds) as MedicationKind[]).filter((k) => counts(k) > 0).map((k) => ({ id: k as KindTab, label: `${kinds[k].emoji} ${kinds[k].label}`, count: counts(k) }))]}
            active={tab}
            onChange={setTab}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((med) => (
              <MedicationCard
                key={med.id}
                med={med}
                kinds={kinds}
                onTaken={() => void run(api.post(`/api/medications/${med.id}/log`, { taken: true }), `Anotado: ${med.name} ✔️`)}
                onToggle={() => void run(api.patch(`/api/medications/${med.id}`, { active: !med.active }), med.active ? 'Pausado: no te aviso hasta que lo reanudes.' : 'Reanudado.')}
                onEdit={() => setEditing(medicationDraftOf(med))}
                onDelete={() => remove(med)}
              />
            ))}
          </div>
        </>
      )}

      {editing && kinds && <MedicationForm initial={editing} kinds={kinds} onCancel={() => setEditing(null)} onSave={save} />}
    </Page>
  );
}
