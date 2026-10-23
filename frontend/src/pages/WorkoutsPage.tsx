import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dumbbell, Flame, MapPin, Plus, Timer } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { Category, Routine, Workout, WorkoutKind, WorkoutsResponse } from '../types/index.ts';
import { todayISO, weekday } from '../utils/dates.ts';
import { Draft, clockText, modeOf } from '../utils/routines.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { StatCard } from '../components/molecules/StatCard.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { RoutineCard } from '../components/organisms/routines/RoutineCard.tsx';
import { RoutineForm } from '../components/organisms/routines/RoutineForm.tsx';
import { ExerciseList } from '../components/organisms/workouts/ExerciseList.tsx';

type KindTab = WorkoutKind | 'all';

/** Quick starts for the empty screen and the "add" menu: the usual ones, prefilled. */
const PRESETS: { title: string; kind: WorkoutKind; emoji: string; duration: string; time: string }[] = [
  { title: 'Boxeo', kind: 'combat', emoji: '🥊', duration: '60', time: '19:00' },
  { title: 'Zumba', kind: 'dance', emoji: '💃', duration: '60', time: '18:00' },
  { title: 'Gym', kind: 'strength', emoji: '🏋️', duration: '60', time: '06:00' },
  { title: 'Correr', kind: 'cardio', emoji: '🏃', duration: '30', time: '06:00' },
  { title: 'Yoga', kind: 'flexibility', emoji: '🧘', duration: '45', time: '07:00' },
];

function emptyDraft(preset?: (typeof PRESETS)[number]): Draft {
  const today = todayISO();
  return {
    title: preset?.title ?? '',
    categoryId: '',
    mode: 'weekly',
    weekdays: [weekday(today)],
    interval: '2',
    monthDay: String(Number(today.slice(8, 10))),
    monthEvery: '1',
    time: preset?.time ?? '19:00',
    duration: preset?.duration ?? '60',
    workoutKind: preset?.kind ?? 'other',
    place: '',
    notes: '',
  };
}

function draftOf(w: Workout): Draft {
  const today = todayISO();
  return {
    id: w.id,
    title: w.title,
    categoryId: w.category_id ? String(w.category_id) : '',
    mode: modeOf(w),
    weekdays: w.weekdays.length && w.weekdays.length < 7 ? w.weekdays : [weekday(today)],
    interval: String(w.freq !== 'monthly' && w.interval > 1 ? w.interval : 2),
    monthDay: String(w.month_day ?? Number(today.slice(8, 10))),
    monthEvery: String(w.freq === 'monthly' ? w.interval : 1),
    time: w.reminder_time,
    duration: String(w.duration_minutes ?? 60),
    workoutKind: w.workout_kind,
    place: w.place ?? '',
    notes: w.notes ?? '',
  };
}

/**
 * Ejercicios: boxeo, zumba, gym, correr... each with its days and hour. The same things Canix
 * handles on WhatsApp ("boxeo los lunes a las 7pm", "mis ejercicios"): at the hour it sends the
 * notice (with the exercises to follow), the answer (👍/👎 or "Sí, lo hice" here) counts toward the
 * week's sessions and minutes and the streak. Each one is a routine underneath, so the card,
 * check-in and history are Rutinas' own.
 */
export function WorkoutsPage() {
  const api = useApi();
  const [data, setData] = useState<WorkoutsResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tab, setTab] = useState<KindTab>('all');
  const [form, setForm] = useState<{ draft: Draft; original: Routine | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [workouts, cats] = await Promise.all([api.get<WorkoutsResponse>('/api/workouts'), api.get<Category[]>('/api/categories').catch(() => [] as Category[])]);
      setData(workouts);
      setCategories(cats);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const all = useMemo(() => [...(data?.items ?? [])].sort((a, b) => a.reminder_time.localeCompare(b.reminder_time) || a.title.localeCompare(b.title)), [data]);
  const items = all.filter((w) => tab === 'all' || w.workout_kind === tab);
  const today = all.filter((w) => w.occurs_today);
  const kinds = data?.kinds;
  const counts = (k: KindTab) => all.filter((w) => k === 'all' || w.workout_kind === k).length;
  const bestStreak = Math.max(0, ...all.map((w) => w.week.streak));
  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '';
  const open = (preset?: (typeof PRESETS)[number]) => setForm({ draft: emptyDraft(preset), original: null });

  return (
    <Page
      title="Ejercicios"
      eyebrow="Hábitos"
      sticker="vamos"
      description="Boxeo, zumba, gym, correr, yoga y cualquier deporte con su horario. A la hora Canix te escribe por WhatsApp con lo que toca; márcalo con 👍/👎 o aquí, y ve tus sesiones, minutos y racha de la semana."
      wide
      actions={
        <Button onClick={() => open()} disabled={!kinds}>
          <Plus size={16} /> Nuevo ejercicio
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!data || !kinds ? (
        <Skeleton className="h-64" />
      ) : all.length === 0 ? (
        <EmptyState
          sticker="vamos"
          title="Todavía no tienes ejercicios"
          description='Agrégalo aquí o dile a Canix por WhatsApp: "boxeo los lunes y miércoles a las 7pm, 1 hora" o "zumba los sábados a las 9am".'
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {PRESETS.map((p) => (
                <Button key={p.title} variant="secondary" onClick={() => open(p)}>
                  {p.emoji} {p.title}
                </Button>
              ))}
              <Button onClick={() => open()}>Otro</Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <StatCard icon={<Dumbbell size={20} />} label="Sesiones esta semana" value={`${data.summary.done} de ${data.summary.due}`} hint={data.summary.due ? `${Math.round((data.summary.done / data.summary.due) * 100)}% de lo planeado` : 'Nada planeado esta semana'} />
            <StatCard icon={<Timer size={20} />} tone="cyan" label="Minutos de ejercicio" value={data.summary.minutes ? data.summary.minutes_text : '0 min'} hint="De lunes a domingo" />
            <StatCard icon={<Flame size={20} />} tone="amber" label="Mejor racha" value={bestStreak} hint={bestStreak ? 'Sesiones seguidas cumplidas' : 'Marca tu primera sesión'} />
          </div>

          {today.length > 0 && (
            <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
              {today.map((w) => (
                <div
                  key={w.id}
                  className={`shrink-0 rounded-2xl border px-3 py-2 text-sm ${
                    w.today_answer === 'yes' ? 'border-success/40 bg-success/10' : w.today_answer === 'no' ? 'border-error/30 bg-error/5' : 'border-gray-medium/60 bg-white dark:border-white/10 dark:bg-white/5'
                  }`}
                >
                  <p className="text-xs font-bold text-primary">Hoy · {clockText(w.reminder_time)}</p>
                  <p className="font-semibold text-ink dark:text-white">
                    {kinds[w.workout_kind]?.emoji} {w.title} {w.today_answer === 'yes' ? '✅' : w.today_answer === 'no' ? '❌' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}

          <Tabs
            tabs={[{ id: 'all' as KindTab, label: 'Todos', count: counts('all') }, ...(Object.keys(kinds) as WorkoutKind[]).filter((k) => counts(k) > 0).map((k) => ({ id: k as KindTab, label: `${kinds[k].emoji} ${kinds[k].label}`, count: counts(k) }))]}
            active={tab}
            onChange={setTab}
          />

          <div className="space-y-3">
            {items.map((w) => (
              <RoutineCard key={w.id} routine={w} categoryName={categoryName(w.category_id)} onChanged={load} onEdit={() => setForm({ draft: draftOf(w), original: w })} onError={setError}>
                <div className="mt-4 grid gap-4 border-t border-gray-medium/70 pt-4 md:grid-cols-[minmax(0,14rem)_1fr] dark:border-white/10">
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold text-ink dark:text-white">
                      {kinds[w.workout_kind]?.emoji} {kinds[w.workout_kind]?.label}
                    </p>
                    {w.place && (
                      <p className="flex items-center gap-1.5 text-gray-dark">
                        <MapPin size={14} className="shrink-0" /> {w.place}
                      </p>
                    )}
                    {w.week.due > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-ink dark:text-white/80">
                          Esta semana: {w.week.done} de {w.week.due}
                          {w.week.minutes > 0 && ` · ${w.week.minutes} min`}
                        </p>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-medium/60 dark:bg-white/10">
                          <div className={`h-full rounded-full transition-all ${w.week.done >= w.week.due ? 'bg-success' : 'brand-gradient'}`} style={{ width: `${Math.min(100, Math.round((w.week.done / w.week.due) * 100))}%` }} />
                        </div>
                      </div>
                    )}
                    {w.notes && <p className="whitespace-pre-line text-xs italic text-gray-dark">{w.notes}</p>}
                  </div>
                  <ExerciseList workoutId={w.id} exercises={w.exercises} onChanged={load} onError={setError} />
                </div>
              </RoutineCard>
            ))}
          </div>
        </>
      )}

      {form && kinds && <RoutineForm initial={form.draft} original={form.original} categories={categories} workoutKinds={kinds} onClose={() => setForm(null)} onSaved={load} />}
    </Page>
  );
}
