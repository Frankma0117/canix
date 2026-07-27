import { useEffect, useState } from 'react';
import { X, CalendarClock } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { Category, Reminder, ReminderStatus } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Select } from '../components/ui/Input.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

const STATUS_TONE: Record<ReminderStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  pending: 'warning',
  executed: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

const RECURRENCE_LABEL: Record<string, string> = {
  none: 'única vez',
  daily: 'cada día',
  weekly: 'cada semana',
  monthly: 'cada mes',
  yearly: 'cada año',
};

export function RemindersPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [status, setStatus] = useState<ReminderStatus>('pending');

  async function load() {
    const [cats, items] = await Promise.all([
      api.get<Category[]>('/api/categories'),
      api.get<Reminder[]>(`/api/reminders?status=${status}`),
    ]);
    setCategories(cats);
    setReminders(items);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function categoryName(id: number | null): string {
    return categories.find((c) => c.id === id)?.name ?? '';
  }

  async function handleCancel(id: number) {
    await api.post(`/api/reminders/${id}/cancel`);
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Recordatorios</h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ReminderStatus)} className="max-w-[10rem]">
          <option value="pending">Pendientes</option>
          <option value="executed">Enviados</option>
          <option value="failed">Fallidos</option>
          <option value="cancelled">Cancelados</option>
        </Select>
      </div>

      <p className="mb-4 text-sm text-gray-dark">
        Los recordatorios se crean pidiéndoselo al bot por WhatsApp (ej. "recuérdame X en 5 minutos" o "todos los
        días a las 8am").
      </p>

      {!reminders && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {reminders && reminders.length === 0 && (
        <EmptyState icon={<CalendarClock />} title="Nada por aquí" />
      )}

      {reminders && reminders.length > 0 && (
        <div className="space-y-2">
          {reminders.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink dark:text-white">{r.message}</p>
                <p className="text-xs text-gray-dark">
                  {r.kind === 'flexible' && r.window_start && r.window_end
                    ? `entre ${r.window_start} y ${r.window_end}`
                    : r.run_at}{' '}
                  · {RECURRENCE_LABEL[r.recurrence_freq]}
                  {r.kind === 'important_date' && ' · 📅 importante'}
                  {categoryName(r.category_id) && ` · ${categoryName(r.category_id)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                {r.status === 'pending' && (
                  <button
                    onClick={() => handleCancel(r.id)}
                    className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                    aria-label="Cancelar"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
