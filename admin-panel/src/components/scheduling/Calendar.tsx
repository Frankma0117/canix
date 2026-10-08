import { useMemo } from 'react';
import type { Appointment, AppointmentStatus, TimeOff } from '../../lib/types.ts';
import { addDaysISO, startOfMonth, startOfWeek, todayISO, WEEKDAY_SHORT, time12, minutesOfDay, formatMonth, formatDayLong } from '../../lib/dates.ts';

export type CalendarView = 'month' | 'week';

export const STATUS_STYLE: Record<AppointmentStatus, string> = {
  pending: 'bg-warning/15 text-amber-700 border-warning/60 dark:text-amber-300',
  confirmed: 'bg-primary/15 text-primary-dark border-primary/60 dark:text-blue-200',
  completed: 'bg-success/15 text-emerald-700 border-success/60 dark:text-emerald-300',
  cancelled: 'bg-gray-medium/60 text-gray-dark border-gray-medium line-through',
  rejected: 'bg-gray-medium/60 text-gray-dark border-gray-medium line-through',
  expired: 'bg-gray-medium/60 text-gray-dark border-gray-medium line-through',
  no_show: 'bg-error/10 text-error border-error/50',
};

export const STATUS_LEGEND: { status: AppointmentStatus; label: string }[] = [
  { status: 'pending', label: 'Pendiente' },
  { status: 'confirmed', label: 'Confirmada' },
  { status: 'completed', label: 'Realizada' },
  { status: 'cancelled', label: 'Cancelada / rechazada' },
];

/** Range [from, to] (inclusive dates) the calendar needs data for, given view + anchor date. */
export function calendarRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDaysISO(from, 6) };
  }
  const from = startOfWeek(startOfMonth(anchor));
  return { from, to: addDaysISO(from, 41) };
}

const HOUR_START = 6;
const HOUR_END = 22;
const PX_PER_MIN = 0.9;

export function Calendar({
  view,
  anchor,
  appointments,
  timeOff = [],
  showProfessional,
  onSelect,
  onDayClick,
}: {
  view: CalendarView;
  anchor: string;
  appointments: Appointment[];
  timeOff?: TimeOff[];
  showProfessional?: boolean;
  onSelect: (a: Appointment) => void;
  onDayClick?: (date: string) => void;
}) {
  const { from } = calendarRange(view, anchor);
  const days = useMemo(() => Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDaysISO(from, i)), [from, view]);
  const today = todayISO();
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) m.set(a.start_at.slice(0, 10), [...(m.get(a.start_at.slice(0, 10)) ?? []), a]);
    return m;
  }, [appointments]);
  const blockedDay = (d: string) => timeOff.some((t) => t.start_at.slice(0, 10) <= d && t.end_at.slice(0, 10) >= d);
  const label = (a: Appointment) => (showProfessional ? `${a.professional_name} · ${a.client_name ?? a.client_phone}` : (a.client_name ?? a.client_phone));

  if (view === 'month') {
    const month = anchor.slice(0, 7);
    return (
      <div>
        <p className="mb-2 font-display text-lg font-semibold capitalize text-ink dark:text-white">{formatMonth(anchor)}</p>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-gray-medium/70 bg-gray-medium/70 dark:border-white/10 dark:bg-white/10">
          {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
            <div key={d} className="bg-gray-light py-1.5 text-center text-xs font-semibold uppercase text-gray-dark dark:bg-[#15162c]">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const out = d.slice(0, 7) !== month;
            return (
              <div
                key={d}
                onClick={() => onDayClick?.(d)}
                className={`min-h-[92px] cursor-pointer p-1.5 ${out ? 'bg-gray-light/70 dark:bg-[#121327]' : 'bg-white dark:bg-[#17182f]'} ${blockedDay(d) ? 'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.04)_6px,rgba(0,0,0,0.04)_12px)]' : ''}`}
              >
                <p className={`mb-1 text-xs font-semibold ${d === today ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white' : out ? 'text-gray-dark/50' : 'text-gray-dark'}`}>{Number(d.slice(8))}</p>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((a) => (
                    <button
                      key={a.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(a);
                      }}
                      className={`block w-full truncate rounded border-l-2 px-1 py-0.5 text-left text-[11px] ${STATUS_STYLE[a.status]}`}
                      title={`${time12(a.start_at)} ${label(a)} - ${a.status_label}`}
                    >
                      {a.start_at.slice(11, 16)} {label(a)}
                    </button>
                  ))}
                  {list.length > 3 && <p className="text-[11px] text-gray-dark">+{list.length - 3} más</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // week view: time grid
  const height = (HOUR_END - HOUR_START) * 60 * PX_PER_MIN;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-gray-medium/70 dark:border-white/10">
          <div />
          {days.map((d, i) => (
            <button key={d} onClick={() => onDayClick?.(d)} className="py-2 text-center">
              <p className="text-xs uppercase text-gray-dark">{WEEKDAY_SHORT[(i + 1) % 7]}</p>
              <p className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${d === today ? 'bg-primary text-white' : 'text-ink dark:text-white'}`}>{Number(d.slice(8))}</p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[52px_repeat(7,1fr)]">
          <div className="relative" style={{ height }}>
            {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
              <p key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-gray-dark" style={{ top: i * 60 * PX_PER_MIN }}>
                {i === 0 ? '' : `${HOUR_START + i}:00`}
              </p>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="relative border-l border-gray-medium/70 dark:border-white/10" style={{ height }}>
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-gray-medium/40 dark:border-white/5" style={{ top: i * 60 * PX_PER_MIN }} />
              ))}
              {timeOff
                .filter((t) => t.start_at.slice(0, 10) <= d && t.end_at.slice(0, 10) >= d)
                .map((t) => {
                  const s = t.start_at.slice(0, 10) < d ? HOUR_START * 60 : Math.max(minutesOfDay(t.start_at), HOUR_START * 60);
                  const e = t.end_at.slice(0, 10) > d ? HOUR_END * 60 : Math.min(minutesOfDay(t.end_at), HOUR_END * 60);
                  if (e <= s) return null;
                  return (
                    <div
                      key={t.id}
                      className="absolute inset-x-0.5 rounded bg-gray-medium/70 px-1 text-[10px] text-gray-dark dark:bg-white/10"
                      style={{ top: (s - HOUR_START * 60) * PX_PER_MIN, height: (e - s) * PX_PER_MIN }}
                      title={t.reason ?? 'Bloqueado'}
                    >
                      🚫 {t.reason ?? 'Bloqueado'}
                    </div>
                  );
                })}
              {(byDay.get(d) ?? []).map((a) => {
                const s = Math.max(minutesOfDay(a.start_at), HOUR_START * 60);
                const e = Math.min(a.end_at.slice(0, 10) > d ? HOUR_END * 60 : minutesOfDay(a.end_at), HOUR_END * 60);
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a)}
                    className={`absolute inset-x-0.5 overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[11px] leading-tight ${STATUS_STYLE[a.status]}`}
                    style={{ top: (s - HOUR_START * 60) * PX_PER_MIN, height: Math.max((e - s) * PX_PER_MIN, 18) }}
                    title={`${formatDayLong(d)} ${time12(a.start_at)} - ${label(a)} (${a.status_label})`}
                  >
                    <span className="font-semibold">{time12(a.start_at)}</span> {label(a)}
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

export function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {STATUS_LEGEND.map((l) => (
        <span key={l.status} className={`rounded border-l-2 px-2 py-0.5 ${STATUS_STYLE[l.status]}`}>
          {l.label}
        </span>
      ))}
    </div>
  );
}
