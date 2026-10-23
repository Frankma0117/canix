import { useEffect, useRef } from 'react';
import type { CalendarEvent, CalendarEventKind } from '../../../types/index.ts';
import { WEEKDAY_SHORT, minutesOfDay, nowWall, time12, todayISO, weekday } from '../../../utils/dates.ts';

/** How each kind of event looks on the calendar (and in its legend). */
export const EVENT_KIND_STYLE: Record<CalendarEventKind, { label: string; emoji: string; className: string; dot: string }> = {
  routine: { label: 'Rutinas', emoji: '🔁', className: 'border-violet-400/60 bg-violet-500/12 text-violet-900 dark:text-violet-100', dot: 'bg-violet-500' },
  reminder: { label: 'Recordatorios', emoji: '⏰', className: 'border-sky-400/60 bg-sky-500/12 text-sky-900 dark:text-sky-100', dot: 'bg-sky-500' },
  todo: { label: 'Tareas', emoji: '✅', className: 'border-emerald-400/60 bg-emerald-500/12 text-emerald-900 dark:text-emerald-100', dot: 'bg-emerald-500' },
  call: { label: 'Llamadas', emoji: '📞', className: 'border-rose-400/60 bg-rose-500/12 text-rose-900 dark:text-rose-100', dot: 'bg-rose-500' },
  meal: { label: 'Comidas', emoji: '🍽️', className: 'border-amber-400/60 bg-amber-500/14 text-amber-900 dark:text-amber-100', dot: 'bg-amber-500' },
  medication: { label: 'Medicamentos y belleza', emoji: '💊', className: 'border-pink-400/60 bg-pink-500/12 text-pink-900 dark:text-pink-100', dot: 'bg-pink-500' },
  appointment: { label: 'Citas', emoji: '🗓️', className: 'border-indigo-400/60 bg-indigo-500/12 text-indigo-900 dark:text-indigo-100', dot: 'bg-indigo-500' },
};

const HOUR_PX = 52;

/** Side-by-side lanes for events that overlap in time, so none hides another. */
function layout(events: CalendarEvent[]): { event: CalendarEvent; lane: number; lanes: number }[] {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const out: { event: CalendarEvent; lane: number; lanes: number }[] = [];
  let cluster: { event: CalendarEvent; lane: number; lanes: number }[] = [];
  let clusterEnd = '';
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.push({ ...c, lanes });
    cluster = [];
  };
  for (const event of sorted) {
    if (cluster.length && event.start >= clusterEnd) flush();
    const laneEnds: string[] = [];
    for (const c of cluster) laneEnds[c.lane] = laneEnds[c.lane] && laneEnds[c.lane] > c.event.end ? laneEnds[c.lane] : c.event.end;
    let lane = laneEnds.findIndex((end) => !end || end <= event.start);
    if (lane < 0) lane = laneEnds.length;
    cluster.push({ event, lane, lanes: 1 });
    clusterEnd = clusterEnd > event.end ? clusterEnd : event.end;
  }
  flush();
  return out;
}

/**
 * A time grid: one column per day, hours down the side, all-day items on top, and a line at the
 * current time. Shows whatever days it's given (7 for a week, 1 for a day).
 */
export function WeekCalendar({ days, events, onSelect }: { days: string[]; events: CalendarEvent[]; onSelect: (event: CalendarEvent) => void }) {
  const timed = events.filter((e) => !e.allDay);
  const minutes = timed.flatMap((e) => [minutesOfDay(e.start), minutesOfDay(e.end) || 24 * 60]);
  const startHour = Math.min(6, ...minutes.map((m) => Math.floor(m / 60)));
  const endHour = Math.max(22, ...minutes.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const today = todayISO();
  const now = nowWall();
  const scroller = useRef<HTMLDivElement>(null);

  // Opens around the current hour instead of at dawn.
  useEffect(() => {
    const top = Math.max(0, (minutesOfDay(`${today} ${now.slice(11, 16)}:00`) / 60 - startHour - 2) * HOUR_PX);
    scroller.current?.scrollTo({ top });
  }, [days.join(','), startHour]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = { gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
      <div className="grid border-b border-gray-medium/70 dark:border-white/10" style={grid}>
        <div />
        {days.map((d) => (
          <div key={d} className={`px-1 py-2 text-center ${d === today ? 'text-primary' : 'text-gray-dark'}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide">{WEEKDAY_SHORT[weekday(d)]}</p>
            <p className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full font-display text-lg font-black ${d === today ? 'bg-primary text-white' : 'text-ink dark:text-white'}`}>
              {Number(d.slice(8, 10))}
            </p>
          </div>
        ))}
      </div>

      {events.some((e) => e.allDay) && (
        <div className="grid border-b border-gray-medium/70 dark:border-white/10" style={grid}>
          <div className="px-1 py-1.5 text-right text-[10px] font-semibold uppercase text-gray-dark">Todo el día</div>
          {days.map((d) => (
            <div key={d} className="space-y-1 border-l border-gray-medium/50 p-1 dark:border-white/5">
              {events
                .filter((e) => e.allDay && e.start.startsWith(d))
                .map((e) => (
                  <button
                    key={e.key}
                    onClick={() => onSelect(e)}
                    className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] font-semibold ${EVENT_KIND_STYLE[e.kind].className} ${e.done ? 'line-through opacity-60' : ''}`}
                  >
                    {EVENT_KIND_STYLE[e.kind].emoji} {e.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scroller} className="max-h-[70vh] overflow-y-auto">
        <div className="relative grid" style={grid}>
          <div>
            {hours.map((h) => (
              <div key={h} className="relative pr-1.5 text-right text-[10px] font-semibold text-gray-dark" style={{ height: HOUR_PX }}>
                <span className="relative -top-1.5">{h === 0 ? '' : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`}</span>
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="relative border-l border-gray-medium/50 dark:border-white/5" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <div key={h} className="border-t border-gray-medium/40 dark:border-white/5" style={{ height: HOUR_PX }} />
              ))}
              {d === today && (
                <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (minutesOfDay(`${d} ${now.slice(11, 16)}:00`) / 60 - startHour) * HOUR_PX }}>
                  <span className="-ml-1 h-2 w-2 rounded-full bg-error" />
                  <span className="h-px flex-1 bg-error" />
                </div>
              )}
              {layout(timed.filter((e) => e.start.startsWith(d))).map(({ event, lane, lanes }) => {
                const start = minutesOfDay(event.start);
                const end = event.end.slice(0, 10) === d ? minutesOfDay(event.end) : 24 * 60;
                const top = (start / 60 - startHour) * HOUR_PX;
                const height = Math.max(22, ((end - start) / 60) * HOUR_PX - 2);
                const style = EVENT_KIND_STYLE[event.kind];
                return (
                  <button
                    key={event.key}
                    onClick={() => onSelect(event)}
                    className={`absolute overflow-hidden rounded-lg border px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm transition-transform hover:z-20 hover:scale-[1.02] ${style.className} ${event.done ? 'opacity-55' : ''}`}
                    style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                    title={`${time12(event.start)} · ${event.title}`}
                  >
                    <span className={`block truncate font-bold ${event.done ? 'line-through' : ''}`}>
                      {event.done ? '✓ ' : `${style.emoji} `}
                      {event.title}
                    </span>
                    {height > 30 && <span className="block truncate opacity-75">{time12(event.start)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
