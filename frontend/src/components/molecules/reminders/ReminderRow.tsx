import { X, Repeat, CalendarHeart, Shuffle, PauseCircle } from 'lucide-react';
import type { Reminder } from '../../../types/index.ts';
import { formatDayLong } from '../../../utils/dates.ts';
import { Card } from '../../atoms/Card.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { IconButton } from '../../atoms/Button.tsx';
import { cap } from '../../../utils/text.ts';

export function everyLabel(r: Reminder): string {
  if (r.kind === 'interval') return 'por intervalos';
  const unit = { daily: ['día', 'días'], weekly: ['semana', 'semanas'], monthly: ['mes', 'meses'], yearly: ['año', 'años'] }[r.recurrence_freq as string];
  if (!unit) return '';
  return r.recurrence_interval > 1 ? `cada ${r.recurrence_interval} ${unit[1]}` : `cada ${unit[0]}`;
}

export function ReminderRow({ r, categoryName, when, onCancel }: { r: Reminder; categoryName: string; when: string; onCancel?: () => void }) {
  return (
    <Card className="flex items-center gap-3 p-3.5 sm:gap-4 sm:p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-xl dark:bg-primary/15" aria-hidden>
        {r.icon || '🔔'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-bold text-ink dark:text-white">{cap(r.message)}</p>
        <p className="mt-0.5 text-sm text-gray-dark">{when}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
          {r.recurrence_freq !== 'none' && (
            <Badge tone="brand">
              <Repeat size={12} /> {cap(everyLabel(r))}
            </Badge>
          )}
          {r.kind === 'important_date' && (
            <Badge tone="violet">
              <CalendarHeart size={12} /> Fecha importante
            </Badge>
          )}
          {r.kind === 'flexible' && (
            <Badge tone="cyan">
              <Shuffle size={12} /> Hora flexible
            </Badge>
          )}
          {r.paused_until && (
            <Badge tone="neutral">
              <PauseCircle size={12} /> En pausa hasta {formatDayLong(r.paused_until.slice(0, 10))}
            </Badge>
          )}
          {categoryName && <Badge tone="neutral">{categoryName}</Badge>}
        </div>
      </div>
      {onCancel && (
        <IconButton label={`Cancelar "${r.message}"`} onClick={onCancel} className="shrink-0 hover:!bg-error/10 hover:!text-error">
          <X size={18} />
        </IconButton>
      )}
    </Card>
  );
}
