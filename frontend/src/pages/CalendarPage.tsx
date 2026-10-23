import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { CalendarEvent, CalendarEventKind } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { Button, IconButton } from '../components/atoms/Button.tsx';
import { Badge } from '../components/atoms/Badge.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { Modal } from '../components/organisms/Modal.tsx';
import { WeekCalendar, EVENT_KIND_STYLE } from '../components/organisms/calendar/WeekCalendar.tsx';
import { addDaysISO, formatDayLong, formatMonth, startOfWeek, time12, todayISO } from '../utils/dates.ts';
import { goTo } from '../utils/navigation.ts';

type View = 'week' | 'day';

/** Where each kind of event is managed in the portal. */
const SECTION_OF: Record<CalendarEventKind, string> = {
  routine: 'routines',
  reminder: 'reminders',
  todo: 'today',
  call: 'call-reminders',
  meal: 'meals',
  medication: 'medications',
  appointment: 'agenda',
};

/**
 * The whole agenda on a time grid: routines (with what was done), reminders, to-dos with a date,
 * call reminders, the meal plan and appointments - by week or by day.
 */
export function CalendarPage() {
  const api = useApi();
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  const [view, setView] = useState<View>(narrow ? 'day' : 'week');
  const [anchor, setAnchor] = useState(todayISO());
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [hidden, setHidden] = useState<Set<CalendarEventKind>>(new Set());
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    const monday = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));
  }, [view, anchor]);

  const load = useCallback(async () => {
    setEvents(null);
    try {
      setEvents(await api.get<CalendarEvent[]>(`/api/calendar?from=${days[0]}&to=${days[days.length - 1]}`));
    } catch (err) {
      setError(errMsg(err));
      setEvents([]);
    }
  }, [api, days]);
  useEffect(() => void load(), [load]);

  const kinds = useMemo(() => [...new Set((events ?? []).map((e) => e.kind))], [events]);
  const visible = (events ?? []).filter((e) => !hidden.has(e.kind));
  const step = view === 'week' ? 7 : 1;
  const title = view === 'day' ? formatDayLong(anchor) : `Semana del ${Number(days[0].slice(8, 10))} · ${formatMonth(days[0])}`;

  function toggleKind(kind: CalendarEventKind) {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <Page title="Calendario" eyebrow="Tu agenda por horas" sticker="agendado" wide description="Rutinas, recordatorios, tareas, comidas, llamadas y citas en un solo lugar.">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs<View> tabs={[{ id: 'week', label: 'Semana' }, { id: 'day', label: 'Día' }]} active={view} onChange={setView} />
        <div className="mb-5 flex items-center gap-1">
          <IconButton label="Anterior" onClick={() => setAnchor(addDaysISO(anchor, -step))}>
            <ChevronLeft size={18} />
          </IconButton>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(todayISO())}>
            Hoy
          </Button>
          <IconButton label="Siguiente" onClick={() => setAnchor(addDaysISO(anchor, step))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <p className="mb-5 font-display text-lg font-extrabold capitalize text-ink dark:text-white">{title}</p>
      </div>

      {kinds.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              aria-pressed={!hidden.has(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-opacity ${hidden.has(k) ? 'opacity-40' : ''} border-gray-medium dark:border-white/10`}
            >
              <span className={`h-2 w-2 rounded-full ${EVENT_KIND_STYLE[k].dot}`} />
              {EVENT_KIND_STYLE[k].label}
            </button>
          ))}
        </div>
      )}

      {events === null ? <Skeleton className="h-96" /> : <WeekCalendar days={days} events={visible} onSelect={setSelected} />}

      {selected && (
        <Modal title={`${EVENT_KIND_STYLE[selected.kind].emoji} ${selected.title}`} onClose={() => setSelected(null)} size="sm">
          <div className="space-y-2 text-sm">
            <p className="capitalize text-ink dark:text-white">{formatDayLong(selected.start.slice(0, 10))}</p>
            {!selected.allDay && (
              <p className="text-gray-dark">
                {time12(selected.start)} – {time12(selected.end)}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="brand">{EVENT_KIND_STYLE[selected.kind].label}</Badge>
              {selected.done === true && <Badge tone="success">Hecho</Badge>}
              {selected.done === false && <Badge tone="warning">No se hizo</Badge>}
              {selected.detail && <Badge>{selected.detail}</Badge>}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cerrar
            </Button>
            <Button onClick={() => goTo(SECTION_OF[selected.kind])}>Ver en {EVENT_KIND_STYLE[selected.kind].label}</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
