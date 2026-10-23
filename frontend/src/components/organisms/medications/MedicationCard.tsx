import { Check, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { Medication, MedicationsResponse } from '../../../types/index.ts';
import { Card } from '../../atoms/Card.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button, IconButton } from '../../atoms/Button.tsx';
import { WEEKDAY_SHORT, time12 } from '../../../utils/dates.ts';

/** One medication: when it's taken, how, until when, and how this week went. */
export function MedicationCard({
  med,
  kinds,
  onTaken,
  onToggle,
  onEdit,
  onDelete,
}: {
  med: Medication;
  kinds: MedicationsResponse['kinds'];
  onTaken: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const kind = kinds[med.kind] ?? kinds.other;
  const days = med.weekdays ? med.weekdays.map((d) => WEEKDAY_SHORT[d]).join(' · ') : 'Todos los días';
  const answered = med.week.taken + med.week.missed;
  const water = med.kind === 'water';
  const pct = med.today.goal > 0 ? Math.min(100, Math.round((med.today.done / med.today.goal) * 100)) : 0;
  return (
    <Card className={`flex flex-col gap-3 p-4 ${med.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{kind.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-ink dark:text-white">{med.name}</p>
          {(med.dose || med.instructions) && <p className="text-sm text-gray-dark">{[med.dose, med.instructions].filter(Boolean).join(' · ')}</p>}
        </div>
        {!med.active && <Badge tone="warning">Pausado</Badge>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {med.times.map((t) => (
          <Badge key={t} tone="brand">
            {time12(`2000-01-01 ${t}:00`)}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-gray-dark">
        {days}
        {med.end_date && <> · hasta el {med.end_date}</>}
      </p>
      {med.notes && <p className="text-xs italic text-gray-dark">{med.notes}</p>}
      {water && med.active && (
        <div>
          <div className="mb-1 flex justify-between text-xs font-semibold text-ink dark:text-white/80">
            <span>
              Hoy: {med.today.done} de {med.today.goal} vasos
            </span>
            {med.today.done >= med.today.goal && med.today.goal > 0 && <span>¡Meta cumplida! 🎉</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-medium/60 dark:bg-white/10">
            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {answered > 0 && !water && (
        <p className="text-xs font-semibold text-ink dark:text-white/80">
          Últimos 7 días: ✅ {med.week.taken}
          {med.week.missed > 0 && <> · ❌ {med.week.missed}</>}
        </p>
      )}

      <div className="mt-auto flex items-center gap-1 border-t border-gray-medium/50 pt-3 dark:border-white/10">
        {med.active && (
          <Button size="sm" variant="soft" onClick={onTaken}>
            <Check size={14} /> {water ? '+1 vaso' : med.kind === 'bodycare' ? 'Hecho hoy' : 'Tomada hoy'}
          </Button>
        )}
        <div className="flex-1" />
        <IconButton label={med.active ? 'Pausar' : 'Reanudar'} onClick={onToggle}>
          {med.active ? <Pause size={15} /> : <Play size={15} />}
        </IconButton>
        <IconButton label="Editar" onClick={onEdit}>
          <Pencil size={15} />
        </IconButton>
        <IconButton label="Borrar" onClick={onDelete}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </Card>
  );
}
