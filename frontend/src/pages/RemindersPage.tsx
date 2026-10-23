import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, errMsg } from '../services/api.ts';
import type { Category, PromptWithResponses, Reminder, ReminderStatus } from '../types/index.ts';
import { addDaysISO, formatDayLong, formatWhen, time12, todayISO } from '../utils/dates.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { SectionTitle } from '../components/molecules/SectionTitle.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { Card } from '../components/atoms/Card.tsx';
import { Badge } from '../components/atoms/Badge.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { ReminderRow } from '../components/molecules/reminders/ReminderRow.tsx';
import { cap } from '../utils/text.ts';

const STATUS_TABS: { id: ReminderStatus; label: string }[] = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'executed', label: 'Enviados' },
  { id: 'cancelled', label: 'Cancelados' },
  { id: 'suspended', label: 'En pausa' },
  { id: 'missed', label: 'No enviados' },
  { id: 'failed', label: 'Fallidos' },
];

const EMPTY_TEXT: Record<ReminderStatus, string> = {
  pending: 'No tienes recordatorios pendientes.',
  executed: 'Todavía no se ha enviado ninguno.',
  cancelled: 'No has cancelado ninguno.',
  suspended: 'Ninguno está en pausa por falta de respuesta.',
  missed: 'Ninguno se quedó sin enviar.',
  failed: 'Ninguno ha fallado.',
};

/** "Hoy", "Mañana", or the full day - the heading rows are grouped under. */
function dayHeading(date: string): string {
  const today = todayISO();
  if (date === today) return `Hoy · ${formatDayLong(date)}`;
  if (date === addDaysISO(today, 1)) return `Mañana · ${formatDayLong(date)}`;
  if (date === addDaysISO(today, -1)) return `Ayer · ${formatDayLong(date)}`;
  return cap(formatDayLong(date));
}

export function RemindersPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [status, setStatus] = useState<ReminderStatus>('pending');
  // What was marked on each reminder (👍 / 👎 on the notice) - routines show theirs on their own page.
  const [answers, setAnswers] = useState<PromptWithResponses[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([api.get<Category[]>('/api/categories').catch(() => [] as Category[]), api.get<Reminder[]>(`/api/reminders?status=${status}`)]);
      setCategories(cats);
      setReminders(items);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
    api
      .get<PromptWithResponses[]>('/api/reminder-responses?limit=60')
      .then((all) => setAnswers(all.filter((p) => p.todo_id === null).slice(0, 12)))
      .catch(() => setAnswers([]));
  }, [api, status]);

  useEffect(() => {
    setReminders(null);
    void load();
  }, [load]);

  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '';

  async function cancel(r: Reminder) {
    if (!confirm(`¿Cancelar el recordatorio "${r.message}"?`)) return;
    try {
      await api.post(`/api/reminders/${r.id}/cancel`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // One-off reminders and the ones that repeat are different things to look for: kept apart.
  const { once, repeating } = useMemo(() => {
    const sorted = [...(reminders ?? [])].sort((a, b) => a.run_at.localeCompare(b.run_at));
    return { once: sorted.filter((r) => r.recurrence_freq === 'none' && r.kind !== 'interval'), repeating: sorted.filter((r) => r.recurrence_freq !== 'none' || r.kind === 'interval') };
  }, [reminders]);
  const onceByDay = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of once) map.set(r.run_at.slice(0, 10), [...(map.get(r.run_at.slice(0, 10)) ?? []), r]);
    return [...map];
  }, [once]);
  const canCancel = status === 'pending';
  const flexibleWhen = (r: Reminder) => (r.kind === 'flexible' && r.window_start && r.window_end ? `entre ${time12(`0000-00-00 ${r.window_start}`)} y ${time12(`0000-00-00 ${r.window_end}`)}` : time12(r.run_at));

  return (
    <Page
      title="Recordatorios"
      eyebrow="Mi día"
      sticker="agendado"
      description={
        <>
          Avisos puntuales que le pides a Canix por WhatsApp ("recuérdame pagar el internet mañana a las 10"). Tus hábitos que se repiten con seguimiento van aparte, en{' '}
          <a href="#/routines" className="font-semibold text-primary hover:underline">
            Rutinas
          </a>
          .
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs tabs={STATUS_TABS} active={status} onChange={setStatus} />

      {!reminders && !error && (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}

      {reminders && reminders.length === 0 && <EmptyState sticker="agendado" title="Nada por aquí" description={EMPTY_TEXT[status]} />}

      {reminders && once.length > 0 && (
        <section aria-label="Recordatorios de una sola vez">
          <SectionTitle hint="Se envían una vez, en su fecha">
            Una sola vez <span className="text-sm font-semibold text-gray-dark">({once.length})</span>
          </SectionTitle>
          <div className="space-y-5">
            {onceByDay.map(([date, rows]) => (
              <div key={date}>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-dark">{dayHeading(date)}</p>
                <div className="space-y-2">
                  {rows.map((r) => (
                    <ReminderRow key={r.id} r={r} categoryName={categoryName(r.category_id)} when={cap(flexibleWhen(r))} onCancel={canCancel ? () => cancel(r) : undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {reminders && repeating.length > 0 && (
        <section aria-label="Recordatorios que se repiten" className={once.length > 0 ? 'mt-8' : undefined}>
          <SectionTitle hint="Vuelven a avisar solos; la fecha es su próximo aviso">
            Se repiten <span className="text-sm font-semibold text-gray-dark">({repeating.length})</span>
          </SectionTitle>
          <div className="space-y-2">
            {repeating.map((r) => (
              <ReminderRow key={r.id} r={r} categoryName={categoryName(r.category_id)} when={`Próximo: ${formatWhen(r.run_at)}`} onCancel={canCancel ? () => cancel(r) : undefined} />
            ))}
          </div>
        </section>
      )}

      {status === 'pending' && answers.length > 0 && (
        <section aria-label="Lo que marcaste" className="mt-8">
          <SectionTitle hint="Lo que respondiste reaccionando 👍 o 👎 a cada aviso, con la hora">Lo que marcaste</SectionTitle>
          <div className="space-y-2">
            {answers.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display font-bold text-ink dark:text-white">{cap(p.title)}</p>
                  <Badge tone={p.answer === 'yes' ? 'success' : p.answer === 'no' ? 'error' : 'warning'}>{p.answer === 'yes' ? 'Hecho' : p.answer === 'no' ? 'No se hizo' : 'Sin respuesta'}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-gray-dark">{p.sent_at ? `Aviso: ${formatWhen(p.sent_at)}` : 'Sin aviso'}</p>
                {p.responses.length > 0 && (
                  <ul className="mt-2 space-y-1 border-l-2 border-gray-medium pl-3 text-sm text-ink dark:border-white/15 dark:text-white/90">
                    {p.responses.map((r) => (
                      <li key={r.id}>
                        {r.answer === 'yes' ? '✅ Sí' : '❌ No'} · {formatWhen(r.created_at)}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
