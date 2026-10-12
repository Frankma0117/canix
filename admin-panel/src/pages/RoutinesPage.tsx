import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Flame, Pencil, Check, X, History, Clock, Timer, CalendarDays, PauseCircle, ChevronDown } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { Category, PromptSource, PromptWithResponses, Routine, RoutineFreq } from '../lib/types.ts';
import { WEEKDAY_NAMES, WEEKDAY_SHORT, formatDayLong, formatWhen, todayISO, weekday } from '../lib/dates.ts';
import { Page, Notice, SectionTitle } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button, IconButton } from '../components/ui/Button.tsx';
import { Input, Label, Select, Hint } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

/** Monday first - how a week is read here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** '08:05' -> ['8:05', 'a. m.'] */
function clock(time: string): [string, string] {
  const [h, m] = time.split(':').map(Number);
  return [`${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`, h < 12 ? 'a. m.' : 'p. m.'];
}
const clockText = (time: string) => clock(time).join(' ');

function wallMs(at: string): number {
  const [d, t = '00:00:00'] = at.split(' ');
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi, s = 0] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, day, h, mi, s);
}

/** "2 h 10 min después del aviso" - empty when it was answered right away or no notice went out. */
function delayText(sentAt: string | null, answeredAt: string): string {
  if (!sentAt) return '';
  const minutes = Math.round((wallMs(answeredAt) - wallMs(sentAt)) / 60_000);
  if (minutes < 10) return 'al momento del aviso';
  if (minutes < 60) return `${minutes} min después del aviso`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min después del aviso`;
  const days = Math.floor(minutes / 1440);
  return `${days} día${days === 1 ? '' : 's'} después del aviso`;
}

const SOURCE_LABEL: Record<PromptSource, string> = {
  poll: 'con la encuesta de WhatsApp',
  reply: 'reaccionando o respondiendo al aviso',
  chat: 'diciéndoselo a Canix',
  web: 'desde el portal',
};

const isEveryDay = (r: Routine) => (r.freq === 'daily' && r.interval === 1) || (r.freq === 'weekly' && r.interval === 1 && r.weekdays.length === 7);
const isWeeklyPlain = (r: Routine) => r.freq === 'weekly' && r.interval === 1 && r.weekdays.length < 7;
const isSpaced = (r: Routine) => (r.freq === 'weekly' && r.interval > 1) || (r.freq === 'daily' && r.interval > 1);
/** Could this routine fall on that weekday at all (whatever week it is)? */
const fallsOn = (r: Routine, wd: number) => r.freq === 'daily' || (r.freq === 'weekly' && r.weekdays.includes(wd));
const byTime = (a: Routine, b: Routine) => a.reminder_time.localeCompare(b.reminder_time) || a.title.localeCompare(b.title);

type Filter = 'all' | 'today' | 'daily' | 'spaced' | 'monthly' | `wd-${number}`;

// ---------------------------------------------------------------------------------------------
// History of answers for one routine
// ---------------------------------------------------------------------------------------------
function ResponseHistory({ routineId }: { routineId: number }) {
  const api = useApi();
  const [items, setItems] = useState<PromptWithResponses[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PromptWithResponses[]>(`/api/todos/${routineId}/responses?limit=30`)
      .then(setItems)
      .catch((e) => setError(errMsg(e)));
  }, [api, routineId]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!items) return <Skeleton className="h-16" />;
  if (items.length === 0) {
    return <p className="text-sm text-gray-dark">Todavía no hay respuestas. Aparecen aquí cada vez que marcas la rutina, con la hora exacta.</p>;
  }

  return (
    <ol className="space-y-3">
      {items.map((p) => (
        <li key={p.id} className="rounded-xl bg-gray-light/70 p-3 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink dark:text-white">{cap(formatDayLong(p.occurrence_date))}</p>
            {p.answer === 'yes' ? <Badge tone="success">Cumplida</Badge> : p.answer === 'no' ? <Badge tone="error">No se hizo</Badge> : <Badge tone="warning">Sin respuesta</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-gray-dark">{p.sent_at ? `Aviso enviado a las ${clockText(p.sent_at.slice(11, 16))}` : 'Marcada sin aviso previo'}</p>
          {p.responses.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-l-2 border-gray-medium pl-3 dark:border-white/15">
              {p.responses.map((r, i) => (
                <li key={r.id} className="text-sm text-ink dark:text-white/90">
                  <span className="font-semibold">{r.answer === 'yes' ? '✅ Sí' : '❌ No'}</span> · {formatWhen(r.created_at)}
                  <span className="block text-xs text-gray-dark">
                    {cap(SOURCE_LABEL[r.source])}
                    {delayText(p.sent_at, r.created_at) && ` · ${delayText(p.sent_at, r.created_at)}`}
                    {i > 0 && ' · cambió la respuesta'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------
// One routine
// ---------------------------------------------------------------------------------------------
function RoutineCard({
  routine,
  categoryName,
  onChanged,
  onEdit,
  onError,
}: {
  routine: Routine;
  categoryName: string;
  onChanged: () => Promise<void>;
  onEdit: (r: Routine) => void;
  onError: (msg: string) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [hour, period] = clock(routine.reminder_time);

  async function mark(done: boolean) {
    setBusy(done ? 'yes' : 'no');
    try {
      await api.post(`/api/todos/${routine.id}/checkin`, { done });
      await onChanged();
      setHistoryKey((k) => k + 1);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar la rutina "${routine.title}"? Se borra también su historial y su racha.`)) return;
    try {
      await api.del(`/api/todos/${routine.id}`);
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    }
  }

  const answered = routine.today_answer;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-[4.5rem] shrink-0 flex-col items-center rounded-2xl bg-secondary px-2 py-2.5 text-primary-dark dark:bg-primary/15 dark:text-white" aria-hidden>
          <span className="font-display text-xl font-black leading-none">{hour}</span>
          <span className="mt-1 text-[11px] font-semibold">{period}</span>
        </div>

        <div className="min-w-0 flex-1 basis-56">
          <h3 className="font-display text-base font-bold text-ink dark:text-white">{routine.title}</h3>
          <p className="sr-only">Aviso a las {clockText(routine.reminder_time)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">
              <CalendarDays size={12} /> {cap(routine.schedule_label)}
            </Badge>
            {routine.duration_minutes ? (
              <Badge tone="neutral">
                <Timer size={12} /> {routine.duration_minutes} min
              </Badge>
            ) : null}
            {routine.streak > 0 && (
              <Badge tone="warning">
                <Flame size={12} /> Racha {routine.streak}
              </Badge>
            )}
            {categoryName && <Badge tone="violet">{categoryName}</Badge>}
            {routine.paused_until && (
              <Badge tone="neutral">
                <PauseCircle size={12} /> En pausa hasta {formatDayLong(routine.paused_until.slice(0, 10))}
              </Badge>
            )}
            {routine.suspended && <Badge tone="error">Suspendida por falta de respuesta</Badge>}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-dark">
            <Clock size={14} className="shrink-0" />
            {routine.suspended
              ? 'Escríbele cualquier cosa a Canix por WhatsApp y se reactiva sola.'
              : routine.next_run_at
                ? `Próximo aviso: ${formatWhen(routine.next_run_at)}`
                : 'Sin próximo aviso programado'}
          </p>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          {routine.occurs_today ? (
            <div role="group" aria-label={`¿Hiciste "${routine.title}" hoy?`} className="flex gap-2">
              <Button
                variant={answered === 'yes' ? 'primary' : 'secondary'}
                aria-pressed={answered === 'yes'}
                loading={busy === 'yes'}
                disabled={busy !== null || answered === 'yes'}
                onClick={() => mark(true)}
                className="flex-1 sm:flex-none"
              >
                <Check size={16} /> {answered === 'yes' ? 'Hecha hoy' : 'Sí, la hice'}
              </Button>
              <Button
                variant={answered === 'no' ? 'danger' : 'secondary'}
                aria-pressed={answered === 'no'}
                loading={busy === 'no'}
                disabled={busy !== null || answered === 'no'}
                onClick={() => mark(false)}
                className="flex-1 sm:flex-none"
              >
                <X size={16} /> {answered === 'no' ? 'No se hizo' : 'No'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-gray-dark sm:text-right">Hoy no toca</p>
          )}
          {routine.occurs_today && routine.today_answered_at && (
            <p className="text-xs text-gray-dark sm:text-right">
              Marcada a las {clockText(routine.today_answered_at.slice(11, 16))}
              {routine.today_sent_at && ` · ${delayText(routine.today_sent_at, routine.today_answered_at)}`}
            </p>
          )}
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
              <History size={14} /> Respuestas <ChevronDown size={14} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </Button>
            <IconButton label={`Editar ${routine.title}`} onClick={() => onEdit(routine)}>
              <Pencil size={16} />
            </IconButton>
            <IconButton label={`Eliminar ${routine.title}`} onClick={handleDelete} className="hover:!bg-error/10 hover:!text-error">
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="mt-4 border-t border-gray-medium/70 pt-4 dark:border-white/10">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-dark">Historial de respuestas</p>
          <ResponseHistory key={historyKey} routineId={routine.id} />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------------------------
type Mode = 'daily' | 'weekly' | 'spaced' | 'monthly' | 'everyN';

const MODES: { id: Mode; title: string; hint: string }[] = [
  { id: 'daily', title: 'Todos los días', hint: 'De lunes a domingo' },
  { id: 'weekly', title: 'Ciertos días de la semana', hint: 'Ej. lunes, miércoles y viernes' },
  { id: 'spaced', title: 'Cada 15 días', hint: 'O cada 3, 4… semanas' },
  { id: 'monthly', title: 'Cada mes', hint: 'Un día fijo del mes' },
  { id: 'everyN', title: 'Cada ciertos días', hint: 'Ej. un día sí y dos no' },
];

interface Draft {
  id?: number;
  title: string;
  categoryId: string;
  mode: Mode;
  weekdays: number[];
  interval: string;
  monthDay: string;
  monthEvery: string;
  time: string;
  duration: string;
}

function modeOf(r: Routine): Mode {
  if (r.freq === 'monthly') return 'monthly';
  if (r.freq === 'weekly') return r.interval > 1 ? 'spaced' : r.weekdays.length === 7 ? 'daily' : 'weekly';
  return r.interval > 1 ? 'everyN' : 'daily';
}

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

/** What the server stores for a draft's "cada cuánto". */
function scheduleOfDraft(d: Draft): { recurrence_freq: RoutineFreq; recurrence_interval: number; weekdays: number[]; month_day: number | null } {
  const n = Math.max(1, Math.trunc(Number(d.interval) || 1));
  const days = [...d.weekdays].sort((a, b) => a - b);
  switch (d.mode) {
    case 'daily':
      return { recurrence_freq: 'daily', recurrence_interval: 1, weekdays: [], month_day: null };
    case 'weekly':
      return { recurrence_freq: 'weekly', recurrence_interval: 1, weekdays: days, month_day: null };
    case 'spaced':
      return { recurrence_freq: 'weekly', recurrence_interval: Math.max(2, n), weekdays: days, month_day: null };
    case 'monthly':
      return { recurrence_freq: 'monthly', recurrence_interval: Math.max(1, Math.trunc(Number(d.monthEvery) || 1)), weekdays: [], month_day: Number(d.monthDay) };
    case 'everyN':
      return { recurrence_freq: 'daily', recurrence_interval: Math.max(2, n), weekdays: [], month_day: null };
  }
}

function joinDays(days: number[]): string {
  const names = WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAY_NAMES[d]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function summaryOf(d: Draft): string {
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

function RoutineForm({
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

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------
export function RoutinesPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
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

  /** Sections shown for the current filter: [title, hint, routines]. */
  const sections = useMemo<{ key: string; title: string; hint?: string; items: Routine[] }[]>(() => {
    const daily = all.filter(isEveryDay);
    const spaced = all.filter(isSpaced);
    const monthly = all.filter((r) => r.freq === 'monthly');
    const perDay = WEEK_ORDER.map((wd) => ({
      key: `wd-${wd}`,
      title: cap(WEEKDAY_NAMES[wd]) + (wd === todayWd ? ' · hoy' : ''),
      hint: 'Rutinas que solo van este día de la semana',
      items: all.filter((r) => isWeeklyPlain(r) && r.weekdays.includes(wd)),
    }));

    if (filter === 'today') {
      return [{ key: 'today', title: `Hoy, ${formatDayLong(todayISO())}`, hint: 'Lo que toca hoy, en orden de hora', items: all.filter((r) => r.occurs_today) }];
    }
    if (filter === 'daily') return [{ key: 'daily', title: 'Todos los días', items: daily }];
    if (filter === 'spaced') return [{ key: 'spaced', title: 'Cada 15 días y más espaciadas', items: spaced }];
    if (filter === 'monthly') return [{ key: 'monthly', title: 'Mensuales', items: monthly }];
    if (filter.startsWith('wd-')) {
      const wd = Number(filter.slice(3));
      return [
        {
          key: filter,
          title: `Los ${WEEKDAY_NAMES[wd]}`,
          hint: 'Todo lo que puede tocar ese día: las de todos los días, las de ese día y las quincenales que caen en él',
          items: all.filter((r) => fallsOn(r, wd)),
        },
      ];
    }
    return [
      { key: 'daily', title: 'Todos los días', items: daily },
      ...perDay,
      { key: 'spaced', title: 'Cada 15 días y más espaciadas', hint: 'Quincenales, cada varias semanas o cada ciertos días', items: spaced },
      { key: 'monthly', title: 'Mensuales', items: monthly },
    ].filter((s) => s.items.length > 0);
  }, [all, filter, todayWd]);

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Todas', count: all.length },
    { id: 'today', label: 'Hoy', count: all.filter((r) => r.occurs_today).length },
    { id: 'daily', label: 'Todos los días', count: all.filter(isEveryDay).length },
    ...WEEK_ORDER.map((wd) => ({ id: `wd-${wd}` as Filter, label: cap(WEEKDAY_SHORT[wd]), count: all.filter((r) => fallsOn(r, wd)).length })),
    { id: 'spaced', label: 'Cada 15 días', count: all.filter(isSpaced).length },
    { id: 'monthly', label: 'Mensuales', count: all.filter((r) => r.freq === 'monthly').length },
  ];

  const todayItems = all.filter((r) => r.occurs_today);
  const todayDone = todayItems.filter((r) => r.today_answer === 'yes').length;
  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '';

  return (
    <Page
      title="Rutinas y hábitos"
      eyebrow="Hábitos"
      sticker="rutina"
      description="Tus rutinas organizadas por día y por frecuencia. Canix te avisa a la hora y tú la marcas con un toque: aquí, o en la encuesta de Sí / No que llega por WhatsApp."
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
            <p className="mb-4 text-sm font-semibold text-ink dark:text-white" aria-live="polite">
              Hoy llevas {todayDone} de {todayItems.length} {todayItems.length === 1 ? 'rutina' : 'rutinas'}.
            </p>
          )}

          <div role="group" aria-label="Filtrar rutinas" className="mb-6 flex flex-wrap gap-2">
            {chips.map((c) => {
              const on = filter === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(c.id)}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${
                    on
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-medium bg-white text-ink hover:border-primary/40 dark:border-white/10 dark:bg-white/5 dark:text-white'
                  }`}
                >
                  {c.label}
                  <span className={`rounded-full px-1.5 text-xs ${on ? 'bg-white/25' : 'bg-gray-medium/70 text-gray-dark dark:bg-white/10 dark:text-white/70'}`}>{c.count}</span>
                </button>
              );
            })}
          </div>

          {sections.map((s) => (
            <section key={s.key} aria-label={s.title}>
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
