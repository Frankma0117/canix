import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { Category, Routine } from '../types/index.ts';
import { WEEKDAY_NAMES, WEEKDAY_SHORT, formatDayLong, todayISO, weekday } from '../utils/dates.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { SectionTitle } from '../components/molecules/SectionTitle.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { Card } from '../components/atoms/Card.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { RoutineCard } from '../components/organisms/routines/RoutineCard.tsx';
import { RoutineForm } from '../components/organisms/routines/RoutineForm.tsx';
import { Draft, WEEK_ORDER, modeOf } from '../utils/routines.ts';

const isEveryDay = (r: Routine) => (r.freq === 'daily' && r.interval === 1) || (r.freq === 'weekly' && r.interval === 1 && r.weekdays.length === 7);

const isWeeklyPlain = (r: Routine) => r.freq === 'weekly' && r.interval === 1 && r.weekdays.length < 7;

const isSpaced = (r: Routine) => (r.freq === 'weekly' && r.interval > 1) || (r.freq === 'daily' && r.interval > 1);

/** Could this routine fall on that weekday at all (whatever week it is)? */
const fallsOn = (r: Routine, wd: number) => r.freq === 'daily' || (r.freq === 'weekly' && r.weekdays.includes(wd));

const byTime = (a: Routine, b: Routine) => a.reminder_time.localeCompare(b.reminder_time) || a.title.localeCompare(b.title);

type View = 'today' | 'day' | 'freq' | 'all';

function emptyDraft(): Draft {
  const today = todayISO();
  return { title: '', categoryId: '', mode: 'daily', weekdays: [weekday(today)], interval: '2', monthDay: String(Number(today.slice(8, 10))), monthEvery: '1', time: '08:00', duration: '30' };
}

function draftOf(r: Routine): Draft {
  const today = todayISO();
  return {
    id: r.id,
    title: r.title,
    categoryId: r.category_id ? String(r.category_id) : '',
    mode: modeOf(r),
    weekdays: r.weekdays.length && r.weekdays.length < 7 ? r.weekdays : [weekday(today)],
    interval: String(r.freq !== 'monthly' && r.interval > 1 ? r.interval : 2),
    monthDay: String(r.month_day ?? Number(today.slice(8, 10))),
    monthEvery: String(r.freq === 'monthly' ? r.interval : 1),
    time: r.reminder_time,
    duration: String(r.duration_minutes ?? 30),
  };
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------
export function RoutinesPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [view, setView] = useState<View>('today');
  const [day, setDay] = useState<number>(() => weekday(todayISO()));
  const [form, setForm] = useState<{ draft: Draft; original: Routine | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([api.get<Category[]>('/api/categories').catch(() => [] as Category[]), api.get<Routine[]>('/api/routines')]);
      setCategories(cats);
      setRoutines(items);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayWd = weekday(todayISO());
  const all = useMemo(() => [...(routines ?? [])].sort(byTime), [routines]);

  /** What the current view shows: one or more titled groups of routines. */
  const sections = useMemo<{ key: string; title: string; hint?: string; items: Routine[] }[]>(() => {
    if (view === 'today') {
      return [{ key: 'today', title: `Hoy, ${formatDayLong(todayISO())}`, hint: 'Lo que toca hoy, en orden de hora', items: all.filter((r) => r.occurs_today) }];
    }
    if (view === 'day') {
      return [
        {
          key: `day-${day}`,
          title: `Los ${WEEKDAY_NAMES[day]}${day === todayWd ? ' · hoy' : ''}`,
          hint: 'Todo lo que puede tocar ese día: las de todos los días, las de ese día y las quincenales que caen en él',
          items: all.filter((r) => fallsOn(r, day)),
        },
      ];
    }
    if (view === 'freq') {
      return [
        { key: 'daily', title: 'Todos los días', items: all.filter(isEveryDay) },
        { key: 'weekly', title: 'Ciertos días de la semana', hint: 'Ej. solo lunes, miércoles y viernes', items: all.filter(isWeeklyPlain) },
        { key: 'spaced', title: 'Cada 15 días y más espaciadas', hint: 'Quincenales, cada varias semanas o cada ciertos días', items: all.filter(isSpaced) },
        { key: 'monthly', title: 'Mensuales', items: all.filter((r) => r.freq === 'monthly') },
      ].filter((s) => s.items.length > 0);
    }
    return [{ key: 'all', title: 'Todas tus rutinas', hint: 'En orden de hora', items: all }];
  }, [all, view, day, todayWd]);

  const todayItems = all.filter((r) => r.occurs_today);
  const todayDone = todayItems.filter((r) => r.today_answer === 'yes').length;
  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '';

  return (
    <Page
      title="Rutinas y hábitos"
      eyebrow="Hábitos"
      sticker="rutina"
      description="Tus hábitos que se repiten, con su racha. Canix te avisa a la hora y tú la marcas con un toque: aquí, o en WhatsApp (encuesta de Sí / No o reaccionando 👍 al aviso)."
      actions={
        <Button onClick={() => setForm({ draft: emptyDraft(), original: null })}>
          <Plus size={16} /> Nueva rutina
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {!routines && !error && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {routines && routines.length === 0 && (
        <EmptyState
          sticker="rutina"
          title="Sin rutinas todavía"
          description='Crea la primera aquí, o pídesela a Canix por WhatsApp: "rutina de ejercicio lunes y jueves a las 7am, 30 minutos".'
          action={
            <Button onClick={() => setForm({ draft: emptyDraft(), original: null })}>
              <Plus size={16} /> Nueva rutina
            </Button>
          }
        />
      )}

      {routines && routines.length > 0 && (
        <>
          {todayItems.length > 0 && (
            <Card className="mb-5 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-base font-extrabold text-ink dark:text-white">Hoy</p>
                <p className="text-sm font-semibold text-gray-dark" aria-live="polite">
                  {todayDone} de {todayItems.length} {todayItems.length === 1 ? 'rutina hecha' : 'rutinas hechas'}
                </p>
              </div>
              <div
                className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-gray-medium/60 dark:bg-white/10"
                role="progressbar"
                aria-valuenow={todayDone}
                aria-valuemin={0}
                aria-valuemax={todayItems.length}
                aria-label="Rutinas hechas hoy"
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ${todayDone === todayItems.length ? 'bg-success' : 'brand-gradient'}`}
                  style={{ width: `${Math.round((todayDone / todayItems.length) * 100)}%` }}
                />
              </div>
            </Card>
          )}

          <Tabs
            tabs={[
              { id: 'today' as View, label: 'Hoy', count: todayItems.length },
              { id: 'day' as View, label: 'Por día' },
              { id: 'freq' as View, label: 'Por frecuencia' },
              { id: 'all' as View, label: 'Todas', count: all.length },
            ]}
            active={view}
            onChange={setView}
          />

          {view === 'day' && (
            <div role="group" aria-label="Día de la semana" className="mb-5 grid grid-cols-7 gap-1 rounded-2xl bg-gray-medium/50 p-1 dark:bg-white/5">
              {WEEK_ORDER.map((wd) => {
                const on = day === wd;
                const count = all.filter((r) => fallsOn(r, wd)).length;
                return (
                  <button
                    key={wd}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${WEEKDAY_NAMES[wd]}, ${count} ${count === 1 ? 'rutina' : 'rutinas'}${wd === todayWd ? ', hoy' : ''}`}
                    onClick={() => setDay(wd)}
                    className={`flex flex-col items-center rounded-xl px-1 py-2 transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${
                      on ? 'bg-white text-ink shadow-sm dark:bg-white/15 dark:text-white' : 'text-gray-dark hover:text-ink dark:hover:text-white'
                    }`}
                  >
                    <span className="text-sm font-bold capitalize">{WEEKDAY_SHORT[wd]}</span>
                    <span className="text-xs font-semibold">{count}</span>
                    <span className={`mt-0.5 h-1 w-1 rounded-full ${wd === todayWd ? 'bg-primary' : 'bg-transparent'}`} aria-hidden />
                  </button>
                );
              })}
            </div>
          )}

          {sections.map((s, index) => (
            <section key={s.key} aria-label={s.title} className={index > 0 ? 'mt-8' : undefined}>
              <SectionTitle hint={s.hint}>
                {s.title} <span className="text-sm font-semibold text-gray-dark">({s.items.length})</span>
              </SectionTitle>
              {s.items.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-gray-medium px-4 py-6 text-center text-sm text-gray-dark dark:border-white/10">No hay rutinas aquí.</p>
              ) : (
                <div className="space-y-3">
                  {s.items.map((r) => (
                    <RoutineCard
                      key={r.id}
                      routine={r}
                      categoryName={categoryName(r.category_id)}
                      onChanged={load}
                      onEdit={(routine) => setForm({ draft: draftOf(routine), original: routine })}
                      onError={setError}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}

      {form && <RoutineForm initial={form.draft} original={form.original} categories={categories} onClose={() => setForm(null)} onSaved={load} />}
    </Page>
  );
}
