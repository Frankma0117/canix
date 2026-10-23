import type { Appointment } from '../../../types/index.ts';
import { Card } from '../../atoms/Card.tsx';
import { STATUS_STYLE } from '../../organisms/scheduling/AppointmentCalendar.tsx';
import { formatWhen } from '../../../utils/dates.ts';

export function AppointmentRow({ a, onClick }: { a: Appointment; onClick: () => void }) {
  return (
    <Card className="flex cursor-pointer items-center justify-between gap-3 p-4 hover:border-primary/50" onClick={onClick}>
      <div className="min-w-0">
        <p className="font-medium capitalize text-ink dark:text-white">{formatWhen(a.start_at)}</p>
        <p className="text-sm text-gray-dark">
          {a.professional_name}
          {a.reason ? ` · ${a.reason}` : ''}
        </p>
      </div>
      <span className={`shrink-0 rounded border-l-2 px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>{a.status_label}</span>
    </Card>
  );
}
