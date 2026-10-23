import { useState, type ReactNode } from 'react';
import { Trash2, Flame, Pencil, Check, X, History, Clock, Timer, CalendarDays, PauseCircle, ChevronDown } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Routine } from '../../../types/index.ts';
import { formatDayLong, formatWhen } from '../../../utils/dates.ts';
import { Card } from '../../atoms/Card.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button, IconButton } from '../../atoms/Button.tsx';
import { ResponseHistory } from './ResponseHistory.tsx';
import { cap } from '../../../utils/text.ts';
import { clock, clockText, delayText } from '../../../utils/routines.ts';

// ---------------------------------------------------------------------------------------------
// One routine
// ---------------------------------------------------------------------------------------------
export function RoutineCard({
  routine,
  categoryName,
  onChanged,
  onEdit,
  onError,
  children,
}: {
  routine: Routine;
  categoryName: string;
  onChanged: () => Promise<void>;
  onEdit: (r: Routine) => void;
  onError: (msg: string) => void;
  /** Extra detail under the main row (Ejercicios: place, week, exercises). */
  children?: ReactNode;
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

  async function reactivate() {
    try {
      await api.post(`/api/todos/${routine.id}/reactivate`);
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
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
          <h3 className="font-display text-base font-bold text-ink dark:text-white">
            {routine.icon && !/\p{Extended_Pictographic}/u.test(routine.title) && <span aria-hidden>{routine.icon} </span>}
            {routine.title}
          </h3>
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
            {!routine.notifying && <Badge tone="error">Sin avisos</Badge>}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-dark">
            <Clock size={14} className="shrink-0" />
            {!routine.notifying
              ? 'Esta rutina no está avisando por WhatsApp.'
              : routine.suspended
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
          {!routine.notifying && (
            <Button variant="soft" size="sm" onClick={reactivate}>
              Activar avisos
            </Button>
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

      {children}

      {showHistory && (
        <div className="mt-4 border-t border-gray-medium/70 pt-4 dark:border-white/10">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-dark">Historial de respuestas</p>
          <ResponseHistory key={historyKey} routineId={routine.id} />
        </div>
      )}
    </Card>
  );
}
